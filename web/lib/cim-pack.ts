/**
 * UNUSED on the live `/cim/TLY-XXX` path.
 * Production redirects from deals_next.cim_url (see cim-open.ts) and must not
 * call Drive or require GOOGLE_SERVICE_ACCOUNT_JSON.
 *
 * Left as a dead helper — list-only, never files.create.
 */
/** Server-only: googleapis cannot ship in the /next card client bundle. */
import { google } from "googleapis";

import {
  CIM_DRIVE_PARENT_ID,
  driveFileViewUrl,
  parseCimDealId,
  pickCimPackFile,
  type CimPackFile,
} from "./cim-pack-id";

export {
  CIM_DRIVE_PARENT_ID,
  cimPackPath,
  driveFileViewUrl,
  fileNameMatchesDeal,
  parseCimDealId,
  pickCimPackFile,
  type CimPackFile,
} from "./cim-pack-id";

const READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

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
  };
};

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

function readonlyDriveClient(credentials: Record<string, unknown>): DriveFilesClient {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [READONLY_SCOPE],
  });
  return google.drive({ version: "v3", auth }) as DriveFilesClient;
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
