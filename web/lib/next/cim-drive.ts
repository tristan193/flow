/**
 * Google Drive is the CIM home. Dirk (Flow) creates the folder when a deal
 * is Shortlisted — CIM is too late; Simon needs the drop folder first.
 * Simon only uploads the PDF. Auto-match of Simon-named folders is fallback
 * for three existing packs only.
 */

export const CIM_ACTIVE_FOLDER_URL =
  "https://drive.google.com/drive/folders/0ABYzLaaJ9ebAUk9PVA";
export const CIM_ACTIVE_FOLDER_ID = "0ABYzLaaJ9ebAUk9PVA";
export const CIM_ARCHIVE_FOLDER_URL =
  "https://drive.google.com/drive/folders/1ucszdZl6NVGbZdVWvnrVPmrLoHsKotkX";
export const CIM_ARCHIVE_FOLDER_ID = "1ucszdZl6NVGbZdVWvnrVPmrLoHsKotkX";

/** Packs Simon already named. Do not design new flow around Simon creating folders. */
export const LEGACY_SIMON_CIM_DEALS = ["TLY-007", "TLY-031", "TLY-092"] as const;

const FOLDER_RE = /drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|open\?id=)([a-zA-Z0-9_-]+)/i;
const FILE_RE = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i;
const ID_QUERY_RE = /[?&]id=([a-zA-Z0-9_-]+)/i;

export function normalizeCimUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isDriveUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "drive.google.com" || host === "docs.google.com";
  } catch {
    return false;
  }
}

/** Folder id when the CIM link is a Drive folder. File-only links return null. */
export function parseDriveFolderId(url: string | null | undefined): string | null {
  if (!url) return null;
  const folder = url.match(FOLDER_RE);
  if (folder?.[1]) return folder[1];
  if (FILE_RE.test(url)) return null;
  const query = url.match(ID_QUERY_RE);
  return query?.[1] ?? null;
}

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

/** Same URL Dirk sends Simon so he can upload the CIM PDF. */
export function cimViewUrl(folderId: string): string {
  return driveFolderUrl(folderId);
}

export function isLegacySimonCimDeal(dealNumber: string | null | undefined): boolean {
  const n = String(dealNumber || "")
    .trim()
    .toUpperCase();
  return (LEGACY_SIMON_CIM_DEALS as readonly string[]).includes(n);
}

/** Drive folder title: `TLY-XXX Headline`. Dirk creates this, not Simon. */
export function cimFolderTitle(dealNumber: string, headline: string): string {
  const number = String(dealNumber || "")
    .trim()
    .toUpperCase();
  const clean = String(headline || "")
    .replace(/[\r\n\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return clean ? `${number} ${clean}` : number;
}

/**
 * Fallback only: parse a Simon-named `TLY-XXX Headline` folder.
 * New packs are created by Dirk — do not rely on this for new deals.
 */
export function dealNumberFromFolderName(name: string): string | null {
  const match = String(name || "")
    .trim()
    .toUpperCase()
    .match(/^(TLY-0*\d+)\b/);
  if (!match) return null;
  const n = Number(match[1].replace(/^TLY-0*/, "") || match[1].replace(/^TLY-/, ""));
  if (!Number.isInteger(n) || n <= 0) return null;
  return `TLY-${String(n).padStart(3, "0")}`;
}

export interface IndexedCimFolder {
  id: string;
  name: string;
  url: string;
  dealNumber: string;
}

export function indexCimFolders(
  folders: Array<{ id?: string | null; name?: string | null }>,
): Map<string, IndexedCimFolder> {
  const out = new Map<string, IndexedCimFolder>();
  for (const folder of folders) {
    const id = folder.id?.trim();
    if (!id) continue;
    const dealNumber = dealNumberFromFolderName(folder.name ?? "");
    if (!dealNumber) continue;
    out.set(dealNumber, {
      id,
      name: folder.name ?? dealNumber,
      url: driveFolderUrl(id),
      dealNumber,
    });
  }
  return out;
}

export function cimLinkLabel(url: string | null | undefined): string {
  if (isDriveUrl(url)) return "Open CIM in Drive";
  return "View CIM";
}

export interface ClosedCimArchive {
  cimUrl: string | null;
  driveFolderId: string | null;
  driveFolderUrl: string | null;
  archiveFolderId: string;
  archiveFolderUrl: string;
  archiveHint: string;
}

export function closedCimArchive(
  deal: { deal_number?: string | null; title?: string | null; cim_url?: string | null },
): ClosedCimArchive {
  const cimUrl = deal.cim_url?.trim() || null;
  const driveFolderId = parseDriveFolderId(cimUrl);
  const label = [deal.deal_number, deal.title].filter(Boolean).join(" ");
  return {
    cimUrl,
    driveFolderId,
    driveFolderUrl: driveFolderId ? driveFolderUrl(driveFolderId) : null,
    archiveFolderId: CIM_ARCHIVE_FOLDER_ID,
    archiveFolderUrl: CIM_ARCHIVE_FOLDER_URL,
    archiveHint: driveFolderId
      ? `Move ${label || "the TLY-XXX Headline"} folder into Archived`
      : `No Drive folder on this deal — attach a Drive CIM link before archiving`,
  };
}
