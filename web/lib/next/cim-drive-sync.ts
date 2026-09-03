import { google } from "googleapis";

import { query, queryOne } from "../db";
import {
  CIM_ACTIVE_FOLDER_ID,
  CIM_ARCHIVE_FOLDER_ID,
  driveFolderUrl,
  indexCimFolders,
  parseDriveFolderId,
  type IndexedCimFolder,
} from "./cim-drive";

const FOLDER_MIME = "application/vnd.google-apps.folder";

function serviceAccountCredentials(): Record<string, unknown> | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}

export function cimDriveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim());
}

function cimDriveClient(write: boolean) {
  const credentials = serviceAccountCredentials();
  if (!credentials) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set. Cannot talk to the CIM Drive folder.");
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      write
        ? "https://www.googleapis.com/auth/drive"
        : "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
  return google.drive({ version: "v3", auth });
}

export async function listActiveCimFolders(): Promise<IndexedCimFolder[]> {
  const drive = cimDriveClient(false);
  const listed = await drive.files.list({
    q: `'${CIM_ACTIVE_FOLDER_ID}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`,
    fields: "files(id, name)",
    orderBy: "name",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return [...indexCimFolders(listed.data.files ?? []).values()];
}

export interface ResolveCimResult {
  scanned: number;
  matched: number;
  written: number;
  error?: string;
}

/** Match `TLY-XXX Headline` child folders and cache cim_url. Does not move stage. */
export async function resolveCimDriveLinks(dealNumbers?: string[]): Promise<ResolveCimResult> {
  if (!cimDriveConfigured()) {
    return { scanned: 0, matched: 0, written: 0, error: "Drive is not configured." };
  }
  try {
    const folders = await listActiveCimFolders();
    const index = new Map(folders.map((folder) => [folder.dealNumber, folder]));
    const wanted = dealNumbers?.map((n) => n.trim().toUpperCase()).filter(Boolean) ?? [];
    const rows =
      wanted.length > 0
        ? await query<{ id: number; deal_number: string; cim_url: string | null }>(
            `SELECT id, deal_number, cim_url FROM deals_next WHERE deal_number IN (${wanted
              .map((_, i) => `$${i + 1}`)
              .join(", ")})`,
            wanted,
          )
        : await query<{ id: number; deal_number: string; cim_url: string | null }>(
            `SELECT id, deal_number, cim_url FROM deals_next`,
          );
    let written = 0;
    let matched = 0;
    for (const row of rows) {
      const hit = index.get(String(row.deal_number).toUpperCase());
      if (!hit) continue;
      matched += 1;
      if (row.cim_url === hit.url) continue;
      await query(`UPDATE deals_next SET cim_url = $1, updated_at = now() WHERE id = $2`, [
        hit.url,
        row.id,
      ]);
      written += 1;
    }
    return { scanned: folders.length, matched, written };
  } catch (error) {
    return {
      scanned: 0,
      matched: 0,
      written: 0,
      error: error instanceof Error ? error.message : "Drive resolve failed.",
    };
  }
}

export async function resolveCimDriveForDeal(dealId: number): Promise<ResolveCimResult> {
  const row = await queryOne<{ deal_number: string }>(
    "SELECT deal_number FROM deals_next WHERE id = $1",
    [dealId],
  );
  if (!row) return { scanned: 0, matched: 0, written: 0 };
  return resolveCimDriveLinks([String(row.deal_number)]);
}

export interface ArchiveCimResult {
  ok: boolean;
  moved: boolean;
  folderId: string | null;
  error?: string;
}

/**
 * Move the deal's Drive pack into Archived. Close still succeeds if Drive fails.
 */
export async function archiveCimFolderForDeal(dealId: number): Promise<ArchiveCimResult> {
  const row = await queryOne<{ cim_url: string | null }>(
    "SELECT cim_url FROM deals_next WHERE id = $1",
    [dealId],
  );
  const folderId = parseDriveFolderId(row?.cim_url ?? null);
  if (!folderId) return { ok: true, moved: false, folderId: null };
  if (!cimDriveConfigured()) {
    return { ok: false, moved: false, folderId, error: "Drive is not configured." };
  }
  try {
    const drive = cimDriveClient(true);
    const meta = await drive.files.get({
      fileId: folderId,
      fields: "id, parents",
      supportsAllDrives: true,
    });
    const parents = meta.data.parents ?? [];
    if (parents.includes(CIM_ARCHIVE_FOLDER_ID)) {
      return { ok: true, moved: false, folderId };
    }
    await drive.files.update({
      fileId: folderId,
      addParents: CIM_ARCHIVE_FOLDER_ID,
      removeParents: parents.filter((id) => id !== CIM_ARCHIVE_FOLDER_ID).join(",") || undefined,
      supportsAllDrives: true,
      fields: "id, parents",
    });
    await query(`UPDATE deals_next SET cim_url = $1, updated_at = now() WHERE id = $2`, [
      driveFolderUrl(folderId),
      dealId,
    ]);
    return { ok: true, moved: true, folderId };
  } catch (error) {
    return {
      ok: false,
      moved: false,
      folderId,
      error: error instanceof Error ? error.message : "Drive archive move failed.",
    };
  }
}
