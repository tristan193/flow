/**
 * Human-facing labels for /next cards. Listing ids (Axial hex, BBS q=,
 * Transworld ####-######) belong under the title — never in the source pill.
 *
 * Kept free of identity.ts so node:test can load this file without .ts extensions.
 */

type SourceKind = "axial" | "bbs" | "vaid" | "tw" | "rejigg" | "wc" | "smb" | "loose";

interface SourceId {
  kind: SourceKind;
  value: string;
  canonical: string;
}

export type DisplayDeal = {
  deal_number?: string | null;
  source_deal_id?: string | null;
  source_ids?: unknown[] | null;
  source?: string | null;
  sub_source?: string | null;
  nickname?: string | null;
  sources?: string | null;
  url?: string | null;
};

const KIND_ORDER: SourceKind[] = ["axial", "bbs", "vaid", "tw", "rejigg", "wc", "smb", "loose"];

const KIND_PREFIX = /^(axial|bbs|vaid|tw|rejigg|wc|smb):(.+)$/i;

const HEX_TOKEN = /^[a-f0-9]{8,}$/i;
const UUIDISH = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const BBS_Q = /^q=\d{6,}$/i;
const TRANSWORLD = /^\d{4}-\d{6}$/;
const DIGITS = /^\d{6,}$/;

const KIND_SOURCE_NAME: Partial<Record<SourceKind, string>> = {
  axial: "Axial",
  bbs: "BizBuySell",
  vaid: "V-AID",
  tw: "Transworld",
  rejigg: "Rejigg",
  wc: "WebsiteClosers",
  smb: "SMB Deal Hunter",
};

const PROVIDER_PATTERNS: Array<[RegExp, string]> = [
  [/bizbuysell/, "BizBuySell"],
  [/axial/, "Axial"],
  [/rejigg/, "Rejigg"],
  [/websiteclosers/, "WebsiteClosers"],
  [/businessexits/, "BusinessExits"],
  [/benchmarktennessee/, "Benchmark International (TN)"],
  [/benchmark/, "Benchmark International"],
  [/bizquest/, "BizQuest"],
  [/dealstream/, "DealStream"],
  [/smbdealhunter/, "SMB Deal Hunter"],
  [/smbdealdigest/, "SMB Deal Digest"],
  [/smbdealexchange/, "SMB Deal Exchange"],
  [/gulfcoast/, "Gulf Coast M&A"],
  [/gatewayma|gateway m&a/, "Gateway M&A"],
  [/vanla/, "Vanla Group"],
  [/\bvaid\b|v-aid/, "V-AID"],
  [/transworld/, "Transworld"],
];

/** True when a string is a listing id, not a source name. */
export function looksLikeListingId(value: string | null | undefined): boolean {
  const v = (value || "").trim();
  if (!v) return false;
  if (KIND_PREFIX.test(v)) return true;
  if (BBS_Q.test(v) || TRANSWORLD.test(v) || HEX_TOKEN.test(v) || UUIDISH.test(v) || DIGITS.test(v)) {
    return true;
  }
  return false;
}

function addSource(out: SourceId[], kind: SourceKind, value: string) {
  const v = value.trim().toLowerCase();
  if (!v) return;
  const canonical = `${kind}:${v}`;
  if (out.some((s) => s.canonical === canonical)) return;
  out.push({ kind, value: v, canonical });
}

function parseCanonical(out: SourceId[], raw: string) {
  const m = raw.trim().match(KIND_PREFIX);
  if (m) addSource(out, m[1].toLowerCase() as SourceKind, m[2]);
}

export function parseStoredSourceIds(
  sourceIds: unknown[] | null | undefined,
  sourceDealId?: string | null,
): SourceId[] {
  const out: SourceId[] = [];
  for (const raw of sourceIds || []) {
    if (typeof raw === "string") {
      parseCanonical(out, raw);
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as { kind?: string; value?: string; canonical?: string };
    if (rec.kind && rec.value && KIND_ORDER.includes(rec.kind as SourceKind)) {
      addSource(out, rec.kind as SourceKind, rec.value);
    } else if (rec.canonical) {
      parseCanonical(out, String(rec.canonical));
    }
  }
  if (sourceDealId) parseCanonical(out, sourceDealId);
  return out;
}

export function formatListingId(id: SourceId): string {
  switch (id.kind) {
    case "bbs":
      return `q=${id.value}`;
    case "vaid":
      return `V-AID ${id.value}`;
    default:
      return id.value;
  }
}

function extractFromUrl(url: string | null | undefined): SourceId[] {
  const out: SourceId[] = [];
  const u = url || "";
  if (!u) return out;

  const axial =
    /(?:opportunity|teaser-share|received-deals|teaser)\/([a-f0-9]{8,}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})/i.exec(
      u,
    );
  if (axial) addSource(out, "axial", axial[1]);

  const bbsQ = /[?&]q=(\d{6,})/i.exec(u);
  if (bbsQ) addSource(out, "bbs", bbsQ[1]);
  const bbsPath = /bizbuysell\.com\/[^?\s"'<>]*?\/(\d{6,})\/?/i.exec(u);
  if (bbsPath) addSource(out, "bbs", bbsPath[1]);

  const rejigg = /rejigg\.com\/app\/businesses\/(\d+)/i.exec(u);
  if (rejigg) addSource(out, "rejigg", rejigg[1]);
  const wc = /websiteclosers\.com\/businesses\/[^?\s"'<>]*?\/(\d{3,})\/?/i.exec(u);
  if (wc) addSource(out, "wc", wc[1]);
  const smb = /[?&]recordid=([a-z0-9_-]{4,})/i.exec(u);
  if (smb) addSource(out, "smb", smb[1]);

  return out;
}

function inferKind(value: string, deal: DisplayDeal): SourceKind {
  if (HEX_TOKEN.test(value) || UUIDISH.test(value)) return "axial";
  if (BBS_Q.test(value)) return "bbs";
  if (TRANSWORLD.test(value)) return "tw";
  const blob = [deal.source, deal.sub_source, deal.sources, deal.url]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (blob.includes("bizbuysell")) return "bbs";
  if (blob.includes("rejigg")) return "rejigg";
  if (blob.includes("websiteclosers")) return "wc";
  if (blob.includes("axial")) return "axial";
  if (/\bvaid\b|v-aid/.test(blob)) return "vaid";
  if (blob.includes("transworld")) return "tw";
  if (blob.includes("smbdeal")) return "smb";
  return "loose";
}

function adoptLoose(out: SourceId[], raw: string | null | undefined, deal: DisplayDeal) {
  const v = (raw || "").trim();
  if (!v || !looksLikeListingId(v)) return;
  const prefixed = v.match(KIND_PREFIX);
  if (prefixed) {
    addSource(out, prefixed[1].toLowerCase() as SourceKind, prefixed[2]);
    return;
  }
  addSource(out, inferKind(v, deal), v.replace(/^q=/i, ""));
}

export function listingIds(deal: DisplayDeal): SourceId[] {
  const out = parseStoredSourceIds(deal.source_ids, deal.source_deal_id);
  for (const id of extractFromUrl(deal.url)) addSource(out, id.kind, id.value);
  // Production often stored the Axial hex / WC number in nickname, not source_ids.
  adoptLoose(out, deal.source_deal_id, deal);
  adoptLoose(out, deal.nickname, deal);
  return out;
}

/** Listing ids in kind order, formatted for the quiet ID line. */
export function listingIdLabels(deal: DisplayDeal): string[] {
  const ids = listingIds(deal);
  const ordered: SourceId[] = [];
  for (const kind of KIND_ORDER) {
    for (const id of ids) {
      if (id.kind === kind && !ordered.some((s) => s.canonical === id.canonical)) {
        ordered.push(id);
      }
    }
  }
  for (const id of ids) {
    if (!ordered.some((s) => s.canonical === id.canonical)) ordered.push(id);
  }
  return ordered.map(formatListingId);
}

export function listingIdLabel(deal: DisplayDeal): string | null {
  const labels = listingIdLabels(deal);
  return labels.length ? labels.join(" · ") : null;
}

/** `TLY-034 · q=2214412` — deal number first, listing id after. */
export function dealIdLine(deal: DisplayDeal): string {
  const parts = [deal.deal_number?.trim(), listingIdLabel(deal)].filter(Boolean);
  return parts.join(" · ");
}

function looksLikeHumanSourceName(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (looksLikeListingId(v)) return false;
  if (/^unknown$/i.test(v)) return false;
  if (/@/.test(v)) return false;
  if (/\.(com|net|org|xyz|co)$/i.test(v)) return false;
  return true;
}

function matchProvider(blob: string): string | null {
  const s = blob.toLowerCase();
  for (const [re, name] of PROVIDER_PATTERNS) {
    if (re.test(s)) return name;
  }
  return null;
}

/** Source chip text: Axial / BizBuySell / Rejigg — never a hex or q= number. */
export function sourceDisplayName(deal: DisplayDeal): string {
  const nick = (deal.nickname || "").trim();
  if (looksLikeHumanSourceName(nick)) return nick;

  const fromBlob = matchProvider(
    [deal.nickname, deal.source, deal.sub_source, deal.sources, deal.url].filter(Boolean).join(" "),
  );
  if (fromBlob) return fromBlob;

  const fromKind = listingIds(deal)[0];
  if (fromKind) {
    const named = KIND_SOURCE_NAME[fromKind.kind];
    if (named) return named;
  }

  const domain = (deal.source || "").trim().toLowerCase().replace(/^www\./, "");
  const core = domain.split(".")[0] || "";
  if (core && !["gmail", "googlemail", "hotmail", "outlook", "yahoo"].includes(core)) {
    return core.charAt(0).toUpperCase() + core.slice(1);
  }
  return "Unknown";
}
