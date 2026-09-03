import { formatDealNumber, parseDealNumber } from "./next/identity";

/**
 * Shared Drive that holds CIM PDFs. Same id as the drive and as the parent
 * folder — list only that folder, never create children.
 *
 * This file is safe for client components (CIM link on /next cards).
 * Drive API lives in cim-pack.ts and must not be imported from the client.
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
