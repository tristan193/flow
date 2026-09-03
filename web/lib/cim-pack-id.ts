import { formatDealNumber, parseDealNumber } from "./next/identity";

/**
 * Shared Drive that holds CIM PDFs. Dirk lists this folder via his Drive
 * connector and stamps the matching file URL onto the deal. The app never
 * calls Drive for `/cim/TLY-XXX`.
 *
 * This file is safe for client components (CIM link on /next cards).
 */
export const CIM_DRIVE_PARENT_ID = "0ABYzLaaJ9ebAUk9PVA";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const PDF_MIME = "application/pdf";

export type CimPackFile = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  modifiedTime?: string | null;
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

const DRIVE_HOSTS = new Set(["drive.google.com", "www.drive.google.com"]);
const FILE_PATH = /^\/file\/d\/([a-zA-Z0-9_-]+)(?:\/|$)/;
const FOLDER_PATH = /\/folders\//;
const FILE_ID = /^[a-zA-Z0-9_-]+$/;

function parseHttpUrl(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

export function isDriveFolderUrl(raw: string | null | undefined): boolean {
  const url = parseHttpUrl(raw ?? "");
  if (!url || url.protocol !== "https:") return false;
  if (!DRIVE_HOSTS.has(url.hostname.toLowerCase())) return false;
  return FOLDER_PATH.test(url.pathname);
}

/** Drive *file* link (view / open / uc). Folders never match. */
export function driveFileIdFromUrl(raw: string | null | undefined): string | null {
  const url = parseHttpUrl(raw ?? "");
  if (!url || url.protocol !== "https:") return null;
  if (!DRIVE_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (FOLDER_PATH.test(url.pathname)) return null;

  const fromPath = url.pathname.match(FILE_PATH);
  if (fromPath) return fromPath[1];

  if (url.pathname === "/open" || url.pathname === "/uc") {
    const id = url.searchParams.get("id")?.trim() ?? "";
    return FILE_ID.test(id) ? id : null;
  }
  return null;
}

export function isDriveFileUrl(raw: string | null | undefined): boolean {
  return driveFileIdFromUrl(raw) != null;
}

export function canonicalDriveFileUrl(raw: string | null | undefined): string | null {
  const id = driveFileIdFromUrl(raw);
  return id ? driveFileViewUrl(id) : null;
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
