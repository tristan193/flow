import { google } from "googleapis";

import { query } from "./db";
import { importCsv, type ImportResult } from "./import";

/**
 * Reads the shared Drive folder the pipeline archives into.
 *
 * The folder is append-only by design — the tooling that writes it cannot
 * overwrite or delete, so every daily snapshot stays there forever under a dated
 * name. That makes "which files have I already imported?" the central problem,
 * and it is answered by the drive_files_seen table rather than by filename
 * guessing.
 *
 * Access uses a Google service account: create one, download its JSON key, and
 * share the Drive folder with the service account's email as a Viewer. That
 * avoids any interactive OAuth flow, which a background import cannot perform.
 */
function driveClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not set. Add the service account key to connect Drive.",
    );
  }

  // Accepts either the raw JSON or a base64 blob, because pasting multi-line
  // JSON into a hosting provider's environment editor usually mangles it.
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const credentials = JSON.parse(json);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  return google.drive({ version: "v3", auth });
}

export function driveFolderId(): string {
  const id = process.env.FLOW_DRIVE_FOLDER_ID?.trim();
  if (!id) throw new Error("FLOW_DRIVE_FOLDER_ID is not set.");
  return id;
}

export interface DriveSyncResult extends ImportResult {
  filesImported: string[];
  filesSkipped: number;
}

/**
 * Imports every CSV snapshot in the folder that has not been imported before.
 *
 * Deals upsert on ext_id, so even if the same listing appears in thirty daily
 * snapshots it stays one row with its earliest first_seen intact.
 */
export async function syncDriveFolder(): Promise<DriveSyncResult> {
  const drive = driveClient();
  const folderId = driveFolderId();

  const listed = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
    fields: "files(id, name, mimeType, modifiedTime, size)",
    orderBy: "name",
    pageSize: 200,
    // The folder is a Shared Drive, which is invisible to the default corpora.
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const seen = await query<{ file_id: string }>("SELECT file_id FROM drive_files_seen");
  const alreadyImported = new Set(seen.map((row) => row.file_id));

  const totals: DriveSyncResult = {
    dealsNew: 0,
    dealsUpdated: 0,
    verdictsApplied: 0,
    skipped: 0,
    filesImported: [],
    filesSkipped: 0,
  };

  for (const file of listed.data.files ?? []) {
    const id = file.id;
    const name = file.name ?? "";
    if (!id) continue;

    // Only the deal snapshots. Verdict logs in this folder belong to the old
    // browser-to-Drive sync loop and are superseded by the app's own database.
    if (!name.toLowerCase().endsWith(".csv")) {
      totals.filesSkipped += 1;
      continue;
    }
    if (alreadyImported.has(id)) {
      totals.filesSkipped += 1;
      continue;
    }

    const download = await drive.files.get(
      { fileId: id, alt: "media", supportsAllDrives: true },
      { responseType: "text" },
    );
    const text =
      typeof download.data === "string" ? download.data : String(download.data ?? "");
    if (!text.trim()) {
      totals.filesSkipped += 1;
      continue;
    }

    const result = await importCsv(text, "drive", name);
    totals.dealsNew += result.dealsNew;
    totals.dealsUpdated += result.dealsUpdated;
    totals.skipped += result.skipped;
    totals.filesImported.push(name);

    await query(
      `INSERT INTO drive_files_seen (file_id, name, rows_seen)
       VALUES ($1, $2, $3)
       ON CONFLICT (file_id) DO UPDATE SET name = excluded.name`,
      [id, name, result.dealsNew + result.dealsUpdated],
    );
  }

  return totals;
}

/** Whether Drive is configured, so the UI can explain itself instead of erroring. */
export function driveConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() && process.env.FLOW_DRIVE_FOLDER_ID?.trim(),
  );
}
