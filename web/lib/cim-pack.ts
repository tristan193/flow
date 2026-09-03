import { google } from "googleapis";

import { formatDealNumber, parseDealNumber } from "./next/identity";

/**
 * Shared Drive that holds CIM PDFs. Same id as the drive and as the parent
 * folder — list only that folder, never create children.
 */
export const CIM_DRIVE_PARENT_ID = "0ABYzLaaJ9ebAUk9PVA";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const PDF_MIME = "application/pdf";
const READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export type CimPackFile = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  modifiedTime?: string | null;
};

export type CimPackLookup =
  | { status: "invalid" }
  | { status: "disconnected" }
  | { status: "missing"; dealNumber: string }
  | { status: "found"; dealNumber: string; fileId: string; name: string; viewUrl: string };

/** Minimal Drive surface — tests inject this so we never touch files.create. */
export type DriveFilesClient = {
  files: {
    list: (params: Record<string, unknown>) => Promise<{
      data: { files?: CimPackFile[] | null; nextPageToken?: string | null };
    }>;
    create?: (...args: unknown[]) => Promise<unknown>;
  };
};

export function parseCimDealId(raw: string | null | undefined): string | null {
  const n = parseDealNumber(raw);
  return n ? formatDealNumber(n) : null;
}

export function cimPackPath(dealNumber: string | null | undefined): string | null {
  const id = parseCimDealId(dealNumber);
  return id ? `/cim/${id}` : null;
}

export function driveFileViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

export function readServiceAccountJson(raw?: string | null): Record<string, unknown> | null {
  const value = (raw === undefined ? process.env.GOOGLE_SERVICE_ACCOUNT_JSON : raw)?.trim();
  if (!value) return null;
  try {
    const json = value.startsWith("{") ? value : Buffer.from(value, "base64").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function cimDriveConfigured(raw?: string | null): boolean {
  return readServiceAccountJson(raw) != null;
}

/** Case-insensitive prefix: `TLY-092 Project Cactus.pdf` matches TLY-092. */
export function fileNameMatchesDeal(name: string, dealNumber: string): boolean {
  const id = parseCimDealId(dealNumber);
  if (!id) return false;
  return name.trim().toUpperCase().startsWith(id);
}

function isPdf(file: CimPackFile): boolean {
  const mime = (file.mimeType ?? "").toLowerCase();
  const name = file.name ?? "";
  return mime === PDF_MIME || name.toLowerCase().endsWith(".pdf");
}

function isFolder(file: CimPackFile): boolean {
  return (file.mimeType ?? "").toLowerCase() === FOLDER_MIME;
}

/**
 * Prefer the newest PDF. Folders never win — the opener must land on a file
 * view, not a Drive folder.
 */
export function pickCimPackFile(files: CimPackFile[], dealNumber: string): CimPackFile | null {
  const matches = files.filter((file) => file.id && fileNameMatchesDeal(file.name ?? "", dealNumber));
  const filesOnly = matches.filter((file) => !isFolder(file));
  const pool = filesOnly.some(isPdf) ? filesOnly.filter(isPdf) : filesOnly;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => {
    const tb = Date.parse(b.modifiedTime ?? "") || 0;
    const ta = Date.parse(a.modifiedTime ?? "") || 0;
    return tb - ta;
  })[0] ?? null;
}

function readonlyDriveClient(credentials: Record<string, unknown>): DriveFilesClient {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [READONLY_SCOPE],
  });
  return google.drive({ version: "v3", auth });
}

async function listParentMatches(
  drive: DriveFilesClient,
  dealNumber: string,
): Promise<CimPackFile[]> {
  const found: CimPackFile[] = [];
  let pageToken: string | undefined;
  do {
    const listed = await drive.files.list({
      q: `'${CIM_DRIVE_PARENT_ID}' in parents and trashed = false and name contains '${dealNumber}'`,
      corpora: "drive",
      driveId: CIM_DRIVE_PARENT_ID,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime)",
      pageSize: 200,
      pageToken,
    });
    found.push(...(listed.data.files ?? []));
    pageToken = listed.data.nextPageToken ?? undefined;
  } while (pageToken);
  return found;
}

export async function lookupCimPack(
  rawId: string,
  opts?: { drive?: DriveFilesClient; credentialsJson?: string | null },
): Promise<CimPackLookup> {
  const dealNumber = parseCimDealId(rawId);
  if (!dealNumber) return { status: "invalid" };

  try {
    let drive = opts?.drive;
    if (!drive) {
      const credentials = readServiceAccountJson(opts?.credentialsJson);
      if (!credentials) return { status: "disconnected" };
      drive = readonlyDriveClient(credentials);
    }

    // Read/list only. Never files.create, update, or delete.
    const listed = await listParentMatches(drive, dealNumber);
    const hit = pickCimPackFile(listed, dealNumber);
    if (!hit?.id) return { status: "missing", dealNumber };
    return {
      status: "found",
      dealNumber,
      fileId: hit.id,
      name: hit.name ?? dealNumber,
      viewUrl: driveFileViewUrl(hit.id),
    };
  } catch {
    return { status: "missing", dealNumber };
  }
}
