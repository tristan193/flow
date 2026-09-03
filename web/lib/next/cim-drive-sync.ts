import { google } from "googleapis";

import { query, queryOne } from "../db";
import {
  CIM_ACTIVE_FOLDER_ID,
  CIM_ARCHIVE_FOLDER_ID,
  LEGACY_SIMON_CIM_DEALS,
  cimFolderTitle,
  cimViewUrl,
  driveFolderUrl,
  indexCimFolders,
  isLegacySimonCimDeal,
  parseDriveFolderId,
  type IndexedCimFolder,
} from "./cim-drive";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export type CreateCimFolderFn = (input: {
  title: string;
  parentId: string;
}) => Promise<{ id: string; viewUrl?: string | null }>;

let createFolderForTests: CreateCimFolderFn | null = null;

/** Test seam — production always uses Drive files.create (folder mimeType). */
export function setCimFolderCreatorForTests(fn: CreateCimFolderFn | null): void {
  createFolderForTests = fn;
}

function serviceAccountCredentials(): Record<string, unknown> | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}

export function cimDriveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) || Boolean(createFolderForTests);
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

/**
 * Fallback only for TLY-007, TLY-031, TLY-092 — folders Simon already named.
 * New deals get a Dirk-created folder via ensureCimFolderForDeal.
 */
export async function resolveCimDriveLinks(dealNumbers?: string[]): Promise<ResolveCimResult> {
  const requested = (dealNumbers ?? [...LEGACY_SIMON_CIM_DEALS])
    .map((n) => n.trim().toUpperCase())
    .filter(isLegacySimonCimDeal);
  if (requested.length === 0) {
    return { scanned: 0, matched: 0, written: 0 };
  }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) {
    return { scanned: 0, matched: 0, written: 0, error: "Drive is not configured." };
  }
  try {
    const folders = await listActiveCimFolders();
    const index = new Map(folders.map((folder) => [folder.dealNumber, folder]));
    const rows = await query<{ id: number; deal_number: string; cim_url: string | null }>(
      `SELECT id, deal_number, cim_url FROM deals_next WHERE deal_number IN (${requested
        .map((_, i) => `$${i + 1}`)
        .join(", ")})`,
      requested,
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

export interface EnsureCimFolderResult {
  ok: boolean;
  created: boolean;
  matched: boolean;
  folderId: string | null;
  viewUrl: string | null;
  folderTitle: string | null;
  error?: string;
}

async function createDriveFolder(title: string): Promise<{ id: string; viewUrl: string }> {
  if (createFolderForTests) {
    const created = await createFolderForTests({ title, parentId: CIM_ACTIVE_FOLDER_ID });
    if (!created.id) throw new Error("Drive create_file returned no id.");
    return { id: created.id, viewUrl: created.viewUrl?.trim() || cimViewUrl(created.id) };
  }
  const drive = cimDriveClient(true);
  const created = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: FOLDER_MIME,
      parents: [CIM_ACTIVE_FOLDER_ID],
    },
    supportsAllDrives: true,
    fields: "id, name, webViewLink",
  });
  const id = created.data.id;
  if (!id) throw new Error("Drive create_file returned no id.");
  return { id, viewUrl: created.data.webViewLink || cimViewUrl(id) };
}

/**
 * Dirk creates `TLY-XXX Headline` under the live parent when a deal is Shortlisted.
 * Google returns the folder id; we store it as cimUrl immediately.
 * CIM is too late — Simon needs the drop folder before he's done.
 * Legacy TLY-007 / 031 / 092 may match an existing Simon-named folder first.
 */
export async function ensureCimFolderForDeal(dealId: number): Promise<EnsureCimFolderResult> {
  const row = await queryOne<{ deal_number: string; title: string; cim_url: string | null }>(
    "SELECT deal_number, title, cim_url FROM deals_next WHERE id = $1",
    [dealId],
  );
  if (!row) return { ok: false, created: false, matched: false, folderId: null, viewUrl: null, folderTitle: null, error: "Deal not found." };

  const dealNumber = String(row.deal_number);
  const folderTitle = cimFolderTitle(dealNumber, String(row.title ?? ""));
  const existing = parseDriveFolderId(row.cim_url);
  if (existing) {
    return {
      ok: true,
      created: false,
      matched: false,
      folderId: existing,
      viewUrl: row.cim_url,
      folderTitle,
    };
  }

  if (isLegacySimonCimDeal(dealNumber)) {
    const matched = await resolveCimDriveLinks([dealNumber]);
    if (matched.written > 0 || matched.matched > 0) {
      const after = await queryOne<{ cim_url: string | null }>(
        "SELECT cim_url FROM deals_next WHERE id = $1",
        [dealId],
      );
      const folderId = parseDriveFolderId(after?.cim_url ?? null);
      if (folderId) {
        return {
          ok: true,
          created: false,
          matched: true,
          folderId,
          viewUrl: after?.cim_url ?? cimViewUrl(folderId),
          folderTitle,
        };
      }
    }
  }

  if (!cimDriveConfigured()) {
    return {
      ok: false,
      created: false,
      matched: false,
      folderId: null,
      viewUrl: null,
      folderTitle,
      error: "Drive is not configured.",
    };
  }

  try {
    const created = await createDriveFolder(folderTitle);
    await query(`UPDATE deals_next SET cim_url = $1, updated_at = now() WHERE id = $2`, [
      created.viewUrl,
      dealId,
    ]);
    return {
      ok: true,
      created: true,
      matched: false,
      folderId: created.id,
      viewUrl: created.viewUrl,
      folderTitle,
    };
  } catch (error) {
    return {
      ok: false,
      created: false,
      matched: false,
      folderId: null,
      viewUrl: null,
      folderTitle,
      error: error instanceof Error ? error.message : "Drive create_file failed.",
    };
  }
}

export async function ensureCimFoldersForDeals(dealIds: number[]): Promise<EnsureCimFolderResult[]> {
  const out: EnsureCimFolderResult[] = [];
  for (const id of dealIds) {
    out.push(await ensureCimFolderForDeal(id));
  }
  return out;
}

export async function resolveCimDriveForDeal(dealId: number): Promise<ResolveCimResult> {
  return ensureCimFolderForDeal(dealId).then((result) => ({
    scanned: result.ok ? 1 : 0,
    matched: result.matched || result.created ? 1 : 0,
    written: result.created || result.matched ? 1 : 0,
    error: result.error,
  }));
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
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) {
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
