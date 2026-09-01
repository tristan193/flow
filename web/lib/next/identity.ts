/**
 * Deal identity — join keys, fingerprints, aliases, thread lists.
 *
 * Matching order (never skip ahead to a weaker key):
 *   1. deal_number (TLY-001)
 *   2. source_deal_id / source_ids (Axial hex, BBS q=, V-AID, Transworld, …)
 *   3. complete fingerprint = normalize(teaser) + broker_firm + round(EBITDA) + geo
 *   4. alias / title overlap AND (broker if both known) AND (geo if both known)
 *
 * NEVER match on broker name alone.
 * NEVER assume one Gmail thread = one deal.
 */

export type SourceKind = "axial" | "bbs" | "vaid" | "tw" | "rejigg" | "wc" | "smb";

export interface SourceId {
  kind: SourceKind;
  value: string;
  canonical: string;
}

export interface IdentityInput {
  dealNumber?: string | null;
  title?: string | null;
  aliasNames?: string[] | null;
  brokerFirm?: string | null;
  city?: string | null;
  state?: string | null;
  ebitda?: number | null;
  sde?: number | null;
  url?: string | null;
  html?: string | null;
  subject?: string | null;
  body?: string | null;
  source?: string | null;
  nickname?: string | null;
  gmailThreadIds?: string[] | null;
  sourceIds?: SourceId[] | null;
}

export interface IdentityRecord {
  dealNumber: string | null;
  sourceDealId: string | null;
  sourceIds: SourceId[];
  fingerprint: string | null;
  fingerprintComplete: boolean;
  aliasNames: string[];
  gmailThreadIds: string[];
  brokerFirm: string | null;
  teaserNorm: string | null;
  geoNorm: string | null;
}

const EBITDA_ROUND = 10_000;

const JUNK_NAME_TOKENS = new Set([
  "llc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "ltd",
  "limited",
  "co",
  "company",
  "the",
  "and",
  "of",
  "a",
  "an",
]);

/** Dropped from broker-firm fingerprints only — not from teaser names. */
const JUNK_BROKER_TOKENS = new Set([
  ...JUNK_NAME_TOKENS,
  "business",
  "advisors",
  "advisor",
  "international",
  "group",
  "partners",
  "capital",
  "associates",
  "brokerage",
]);

/** Axial hex lives in Pursue/Pass HTML URLs — never take it from the subject. */
const AXIAL_PATH =
  /(?:opportunity|teaser-share|received-deals|teaser)\/([a-f0-9]{8,}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})/gi;
const AXIAL_QP =
  /(?:opportunityid|dealid|teaserid|oid|opportunity_id)=([a-f0-9]{8,}(?:-[a-f0-9]{4,})*)/gi;
const BBS_Q = /[?&]q=(\d{6,})/gi;
const BBS_PATH = /bizbuysell\.com\/[^?\s"'<>]*?\/(\d{6,})\/?/gi;
const REJIGG = /rejigg\.com\/app\/businesses\/(\d+)/gi;
const WC = /websiteclosers\.com\/businesses\/[^?\s"'<>]*?\/(\d{3,})\/?/gi;
const SMB = /[?&]recordid=([a-z0-9_-]{4,})/gi;
const VAID_LABELED = /\b(?:v-?aid|vaid)[:\s#-]*(\d{6})\b/gi;
const TRANSWORLD = /\b(\d{4}-\d{6})\b/g;
const HEX_TOKEN = /^[a-f0-9]{8,}$/i;
const UUIDISH = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function formatDealNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error("Deal number must be a positive integer.");
  return `TLY-${String(n).padStart(3, "0")}`;
}

export function parseDealNumber(value: string | null | undefined): number | null {
  const m = String(value || "")
    .trim()
    .toUpperCase()
    .match(/^TLY-0*(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function normalizeTeaserName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const tokens = raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t && !JUNK_NAME_TOKENS.has(t));
  return tokens.length ? tokens.join(" ") : null;
}

export function normalizeBrokerFirm(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const tokens = raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t && !JUNK_BROKER_TOKENS.has(t));
  return tokens.length ? tokens.join(" ") : null;
}

export function normalizeGeo(
  city?: string | null,
  state?: string | null,
): string | null {
  const st = (state || "").trim().toUpperCase();
  const c = (city || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (st && c) return `${c}|${st}`;
  if (st) return st;
  if (c) return c;
  return null;
}

export function roundEbitda(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value / EBITDA_ROUND) * EBITDA_ROUND;
}

/** Fingerprint only when teaser + broker + earnings + geo are all present. */
export function computeFingerprint(input: {
  title?: string | null;
  brokerFirm?: string | null;
  ebitda?: number | null;
  sde?: number | null;
  city?: string | null;
  state?: string | null;
}): { fingerprint: string | null; complete: boolean } {
  const teaser = normalizeTeaserName(input.title);
  const broker = normalizeBrokerFirm(input.brokerFirm);
  // Prefer labeled EBITDA; SDE is a last-resort stand-in so two SDE-only
  // teasers of the same shop can still join. Never invent a figure.
  const earnings = roundEbitda(input.ebitda ?? input.sde ?? null);
  const geo = normalizeGeo(input.city, input.state);
  if (!teaser || !broker || earnings == null || !geo) {
    return { fingerprint: null, complete: false };
  }
  return { fingerprint: `${teaser}|${broker}|${earnings}|${geo}`, complete: true };
}

/**
 * Harvest leftover keys (`format:gmail_msg:index`). Never a Next join key.
 * Matching uses deal number → source id → fingerprint only.
 */
export function isHarvestExtId(value: string | null | undefined): boolean {
  const v = (value || "").trim().toLowerCase();
  if (!v) return true;
  if (v.startsWith("gmail:") || v.includes("gmail_msg")) return true;
  // format:gmail_msg:index — e.g. axial.teaser:18abc:0
  if (/^[a-z0-9_.-]+:[a-z0-9_-]+:\d+$/.test(v)) return true;
  return false;
}

export function sanitizeSourceDealId(value: string | null | undefined): string | null {
  const v = (value || "").trim().toLowerCase();
  if (!v || isHarvestExtId(v)) return null;
  return v;
}

function addSource(out: SourceId[], kind: SourceKind, value: string) {
  const v = value.trim().toLowerCase();
  if (!v || isHarvestExtId(v)) return;
  const canonical = `${kind}:${v}`;
  if (isHarvestExtId(canonical)) return;
  if (out.some((s) => s.canonical === canonical)) return;
  out.push({ kind, value: v, canonical });
}

function haystack(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join("\n");
}

function isVaidMailbox(input: IdentityInput): boolean {
  const blob = `${input.source || ""} ${input.nickname || ""}`.toLowerCase();
  return blob.includes("vaid") || blob.includes("v-aid");
}

/**
 * Pull platform listing IDs. Axial hex is taken from HTML/URL only — subjects
 * are marketing titles and must not be treated as IDs.
 */
export function extractSourceIds(input: IdentityInput): SourceId[] {
  const out: SourceId[] = [];
  if (input.sourceIds?.length) {
    for (const s of input.sourceIds) {
      if (isHarvestExtId(s.value) || isHarvestExtId(s.canonical)) continue;
      addSource(out, s.kind, s.value);
    }
  }

  const urlHtml = haystack([input.url, input.html, input.body]);
  const subject = input.subject || "";

  for (const re of [AXIAL_PATH, AXIAL_QP]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(urlHtml))) {
      const raw = m[1];
      if (HEX_TOKEN.test(raw) || UUIDISH.test(raw)) addSource(out, "axial", raw);
    }
  }

  BBS_Q.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BBS_Q.exec(urlHtml))) addSource(out, "bbs", m[1]);
  BBS_PATH.lastIndex = 0;
  while ((m = BBS_PATH.exec(urlHtml))) addSource(out, "bbs", m[1]);

  REJIGG.lastIndex = 0;
  while ((m = REJIGG.exec(urlHtml))) addSource(out, "rejigg", m[1]);
  WC.lastIndex = 0;
  while ((m = WC.exec(urlHtml))) addSource(out, "wc", m[1]);
  SMB.lastIndex = 0;
  while ((m = SMB.exec(urlHtml))) addSource(out, "smb", m[1]);

  const idText = haystack([subject, input.body, input.html]);
  VAID_LABELED.lastIndex = 0;
  while ((m = VAID_LABELED.exec(idText))) addSource(out, "vaid", m[1]);
  if (isVaidMailbox(input)) {
    const lone = subject.match(/\b(\d{6})\b/);
    if (lone) addSource(out, "vaid", lone[1]);
  }

  TRANSWORLD.lastIndex = 0;
  while ((m = TRANSWORLD.exec(idText))) addSource(out, "tw", m[1]);

  const nickHex = axialHexFromNickname(input.nickname);
  if (nickHex) addSource(out, "axial", nickHex);

  return out;
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  return [];
}

export function parseSourceIdsValue(value: unknown): SourceId[] {
  if (Array.isArray(value)) {
    const out: SourceId[] = [];
    for (const raw of value) {
      if (!raw || typeof raw !== "object") {
        if (typeof raw === "string") {
          const v = sanitizeSourceDealId(raw);
          if (!v) continue;
          const colon = v.indexOf(":");
          if (colon > 0) {
            addSource(out, v.slice(0, colon) as SourceKind, v.slice(colon + 1));
          }
        }
        continue;
      }
      const rec = raw as Record<string, unknown>;
      const kind = String(rec.kind || "");
      const val = String(rec.value || "");
      if (!kind || !val || isHarvestExtId(val) || isHarvestExtId(String(rec.canonical || ""))) continue;
      addSource(out, kind as SourceKind, val);
    }
    return out;
  }
  if (typeof value === "string") {
    try {
      return parseSourceIdsValue(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

export function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = (raw || "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function mergeAliasNames(
  existing: string[] | null | undefined,
  incomingTitle: string | null | undefined,
  storedTitle: string | null | undefined,
  extra?: string[] | null,
): string[] {
  const aliases = uniqueStrings([...(existing || []), ...(extra || [])]);
  const incoming = (incomingTitle || "").trim();
  const stored = (storedTitle || "").trim();
  if (incoming && stored && normalizeTeaserName(incoming) !== normalizeTeaserName(stored)) {
    if (!aliases.some((a) => normalizeTeaserName(a) === normalizeTeaserName(stored))) {
      aliases.push(stored);
    }
    if (!aliases.some((a) => normalizeTeaserName(a) === normalizeTeaserName(incoming))) {
      aliases.push(incoming);
    }
  }
  return uniqueStrings(aliases);
}

export function mergeThreadIds(
  existing: string[] | null | undefined,
  incoming: string[] | null | undefined,
): string[] {
  return uniqueStrings([...(existing || []), ...(incoming || [])]);
}

export function pickCanonicalSourceId(ids: SourceId[]): string | null {
  const order: SourceKind[] = ["axial", "bbs", "vaid", "tw", "rejigg", "wc", "smb"];
  for (const kind of order) {
    const hit = ids.find((s) => s.kind === kind);
    if (hit) return hit.canonical;
  }
  return ids[0]?.canonical ?? null;
}

export function buildIdentity(input: IdentityInput): IdentityRecord {
  const sourceIds = extractSourceIds(input);
  const fp = computeFingerprint(input);
  return {
    dealNumber: input.dealNumber?.trim().toUpperCase() || null,
    sourceDealId: pickCanonicalSourceId(sourceIds),
    sourceIds,
    fingerprint: fp.fingerprint,
    fingerprintComplete: fp.complete,
    aliasNames: uniqueStrings([...(input.aliasNames || []), input.title || ""]),
    gmailThreadIds: uniqueStrings(input.gmailThreadIds || []),
    brokerFirm: input.brokerFirm?.trim() || null,
    teaserNorm: normalizeTeaserName(input.title),
    geoNorm: normalizeGeo(input.city, input.state),
  };
}

export interface MatchCandidate {
  id: number;
  dealNumber?: string | null;
  sourceDealId?: string | null;
  sourceIds?: Array<SourceId | string | { kind?: string; value?: string; canonical?: string }> | null;
  fingerprint?: string | null;
  title?: string | null;
  aliasNames?: string[] | null;
  brokerFirm?: string | null;
  city?: string | null;
  state?: string | null;
  nickname?: string | null;
}

export type MatchReason =
  | "deal_number"
  | "source_id"
  | "fingerprint"
  | "alias"
  | null;

function candidateSourceCanonicals(c: MatchCandidate): Set<string> {
  const out = new Set<string>();
  const sid = sanitizeSourceDealId(c.sourceDealId);
  if (sid) out.add(sid);
  const nickHex = axialHexFromNickname(c.nickname);
  if (nickHex) out.add(`axial:${nickHex}`);
  for (const raw of c.sourceIds || []) {
    if (typeof raw === "string") {
      const v = sanitizeSourceDealId(raw);
      if (v) out.add(v);
      continue;
    }
    const canonical = raw.canonical
      ? String(raw.canonical).toLowerCase()
      : raw.kind && raw.value
        ? `${raw.kind}:${raw.value}`.toLowerCase()
        : "";
    const cleaned = sanitizeSourceDealId(canonical);
    if (cleaned) out.add(cleaned);
  }
  return out;
}

function titlesOverlap(a: string | null | undefined, bList: string[]): boolean {
  const na = normalizeTeaserName(a);
  if (!na) return false;
  return bList.some((t) => normalizeTeaserName(t) === na);
}

/**
 * First matching candidate wins. Broker-only and thread-only never match.
 */
export function findIdentityMatch(
  incoming: IdentityInput,
  candidates: MatchCandidate[],
): { candidate: MatchCandidate; reason: Exclude<MatchReason, null> } | null {
  const ident = buildIdentity(incoming);
  const incomingNumber = ident.dealNumber ? parseDealNumber(ident.dealNumber) : null;

  if (incomingNumber) {
    const hit = candidates.find((c) => parseDealNumber(c.dealNumber) === incomingNumber);
    if (hit) return { candidate: hit, reason: "deal_number" };
  }

  const incomingIds = new Set(ident.sourceIds.map((s) => s.canonical));
  if (incomingIds.size) {
    const hit = candidates.find((c) => {
      const theirs = candidateSourceCanonicals(c);
      for (const id of incomingIds) if (theirs.has(id)) return true;
      return false;
    });
    if (hit) return { candidate: hit, reason: "source_id" };
  }

  if (ident.fingerprintComplete && ident.fingerprint) {
    const hit = candidates.find((c) => c.fingerprint && c.fingerprint === ident.fingerprint);
    if (hit) return { candidate: hit, reason: "fingerprint" };
  }

  const incomingTitle = incoming.title || null;
  const incomingAliases = uniqueStrings([...(incoming.aliasNames || []), incomingTitle || ""]);
  const incomingBroker = normalizeBrokerFirm(incoming.brokerFirm);
  const incomingGeo = normalizeGeo(incoming.city, incoming.state);

  for (const c of candidates) {
    const theirNames = uniqueStrings([c.title || "", ...(c.aliasNames || [])]);
    const nameHit =
      titlesOverlap(incomingTitle, theirNames) ||
      incomingAliases.some((a) => titlesOverlap(a, theirNames));
    if (!nameHit) continue;

    const theirBroker = normalizeBrokerFirm(c.brokerFirm);
    if (incomingBroker && theirBroker && incomingBroker !== theirBroker) continue;

    const theirGeo = normalizeGeo(c.city, c.state);
    if (incomingGeo && theirGeo && incomingGeo !== theirGeo) continue;

    // Name overlap alone is allowed only when at least one of broker or geo
    // is shared — never broker-only, never a bare title against a different shop.
    const brokerShared = Boolean(incomingBroker && theirBroker && incomingBroker === theirBroker);
    const geoShared = Boolean(incomingGeo && theirGeo && incomingGeo === theirGeo);
    if (!brokerShared && !geoShared) continue;

    return { candidate: c, reason: "alias" };
  }

  return null;
}

/** Marketing / work-queue mail that must not mint a deal. */
export function isNonDealMail(input: {
  subject?: string | null;
  sender?: string | null;
  source?: string | null;
  nickname?: string | null;
  formatId?: string | null;
}): boolean {
  const subject = (input.subject || "").toLowerCase();
  const blob = `${input.sender || ""} ${input.source || ""} ${input.nickname || ""} ${input.formatId || ""}`.toLowerCase();
  if (/action summary/.test(subject)) return true;
  if ((input.formatId || "").includes("action_summary")) return true;
  if (/\bahc\b|ahcpartners|american healthcare/.test(blob) && /blast|digest|newsletter/.test(subject + blob)) {
    return true;
  }
  if (/\bbaton\b/.test(blob) && /digest|newsletter|weekly|blast/.test(subject + blob)) return true;
  return false;
}

export function gmailAllHref(threadId: string): string {
  const id = threadId.trim();
  return `https://mail.google.com/mail/u/0/#all/${id}`;
}

/** Axial hex stored as the nickname pill (not the provider label "Axial"). */
export function axialHexFromNickname(nickname: string | null | undefined): string | null {
  const raw = (nickname || "").trim().toLowerCase();
  if (!raw) return null;
  const labeled = raw.match(/^axial:([a-f0-9]{8,}(?:-[a-f0-9]{4,})*)$/i);
  if (labeled) return labeled[1].toLowerCase();
  if (HEX_TOKEN.test(raw) || UUIDISH.test(raw)) return raw;
  return null;
}

export function identityGroupKeys(input: {
  sourceDealId?: string | null;
  sourceIds?: unknown;
  nickname?: string | null;
  url?: string | null;
  html?: string | null;
}): string[] {
  const keys = new Set<string>();
  const sid = sanitizeSourceDealId(input.sourceDealId);
  if (sid) keys.add(sid);
  for (const s of parseSourceIdsValue(input.sourceIds)) keys.add(s.canonical);
  const hex = axialHexFromNickname(input.nickname);
  if (hex) keys.add(`axial:${hex}`);
  for (const s of extractSourceIds({ url: input.url, html: input.html ?? input.url })) {
    keys.add(s.canonical);
  }
  return [...keys];
}
