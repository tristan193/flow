import { resolveMachineActor } from "../actors";
import { canonicalCimUrl, parseCimDealId } from "../cim-pack-id";
import { type QueryFn, withTransaction } from "../db";
import { parseOptionalMargin, parseOptionalMoney } from "./cim-financials-auth";
import { getNextDeal } from "./deals";
import { formatDealNumber, mergeAliasNames } from "./identity";
import {
  type NextDeal,
  type NextStageId,
  coerceNextStage,
  nextActionAfterCimPack,
  nextFollowupKind,
  shouldAdvanceToCimOnPack,
} from "./model";

/** Machine actor for token-driven CIM intake (same family as /api/next/stage). */
export const CIM_INTAKE_ACTOR = "dirk";

export type CimIntakePatch = {
  revenue?: number;
  ebitda?: number;
  margin?: number;
  asking?: number;
  /** CIM company / project / nickname. Omitted when Simon did not send one. */
  cimName?: string;
  /** HQ city. Omitted when Simon did not send one. */
  city?: string;
  /** HQ state / region. Foreign HQ (Bermuda) also lands here — no country column. */
  state?: string;
  /** Optional county. Never required. */
  county?: string;
};

export const CIM_INTAKE_MAX_BATCH = 50;

export interface AuthorizedCimIntakeInput {
  authorization: string | null;
  fileName?: unknown;
  file_name?: unknown;
  cimUrl?: unknown;
  cim_url?: unknown;
  link?: unknown;
  packUrl?: unknown;
  pack_url?: unknown;
  url?: unknown;
  dealNumber?: unknown;
  deal_number?: unknown;
  dealId?: unknown;
  deal_id?: unknown;
  deal?: unknown;
  dealUrl?: unknown;
  deal_url?: unknown;
  revenue?: unknown;
  ebitda?: unknown;
  margin?: unknown;
  asking?: unknown;
  asking_price?: unknown;
  price?: unknown;
  cimName?: unknown;
  cim_name?: unknown;
  companyName?: unknown;
  company_name?: unknown;
  headline?: unknown;
  city?: unknown;
  City?: unknown;
  state?: unknown;
  State?: unknown;
  region?: unknown;
  Region?: unknown;
  county?: unknown;
  County?: unknown;
  country?: unknown;
  Country?: unknown;
  location?: unknown;
  Location?: unknown;
}

export type AuthorizedCimIntakeResult =
  | {
      ok: true;
      dealId: number;
      dealNumber: string;
      stage: NextStageId;
      cimUrl: string;
      revenue: number | null;
      ebitda: number | null;
      margin: number | null;
      asking: number | null;
      cimName: string | null;
      city: string | null;
      state: string | null;
      county: string | null;
      deal: NextDeal;
    }
  | { ok: false; error: string; status: number };

function bodyField(body: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
      return body[key];
    }
  }
  return undefined;
}

/**
 * Canonical TLY from Simon's upload name: `TLY-XXX Headline.pdf`.
 * Basename only; must start with TLY-digits. Pads to TLY-001.
 */
export function parseTlyFromFileName(fileName: string | null | undefined): string | null {
  if (fileName == null) return null;
  const base = String(fileName).trim().split(/[/\\]/).pop() ?? "";
  if (!base) return null;
  const m = base.toUpperCase().match(/^TLY-0*(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1) return null;
  return formatDealNumber(n);
}

/** Simon's CIM display name. Empty / whitespace is omitted — never invented. */
export function parseOptionalCimName(raw: unknown): { ok: true; value?: string } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true };
  const value = String(raw).trim();
  if (!value) return { ok: true };
  if (value.length > 240) return { ok: false, error: "cimName is too long" };
  return { ok: true, value };
}

const US_STATE_ABBR = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]);

/** Trimmed geo token. Empty / whitespace is omitted — never invented. */
export function parseOptionalGeoField(
  raw: unknown,
  label: string,
): { ok: true; value?: string } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true };
  const value = String(raw).trim();
  if (!value) return { ok: true };
  if (value.length > 80) return { ok: false, error: `${label} is too long` };
  return { ok: true, value: normalizeGeoToken(value) };
}

function normalizeGeoToken(value: string): string {
  if (value.length === 2 && /^[A-Za-z]{2}$/.test(value)) return value.toUpperCase();
  return value;
}

function looksLikePlace(value: string): boolean {
  if (!value || value.length > 40) return false;
  if (/\d/.test(value)) return false;
  return /^[A-Za-z][A-Za-z.\-/' ]{0,38}[A-Za-z.]?$/.test(value);
}

/**
 * Best-effort `location` → city/state. Does not invent geo.
 * "Austin, TX" → Austin / TX. "Hamilton, Bermuda" → Hamilton / Bermuda.
 */
export function parseLocationString(raw: unknown): { city?: string; state?: string; county?: string } {
  if (raw === undefined || raw === null) return {};
  const value = String(raw).trim();
  if (!value || value.length > 80) return {};
  if (/available in a location near you/i.test(value)) return {};

  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 2) {
    const [left, right] = parts;
    if (!looksLikePlace(left) || !looksLikePlace(right)) return {};
    const countyMatch = left.match(/^(.+?)\s+County$/i);
    if (countyMatch && (right.length === 2 ? US_STATE_ABBR.has(right.toUpperCase()) : looksLikePlace(right))) {
      return { county: countyMatch[1].trim(), state: normalizeGeoToken(right) };
    }
    return { city: left, state: normalizeGeoToken(right) };
  }
  if (parts.length === 1) {
    const lone = parts[0];
    const spaced = lone.match(/^(.+?)\s+([A-Za-z]{2})$/);
    if (spaced && US_STATE_ABBR.has(spaced[2].toUpperCase()) && looksLikePlace(spaced[1].trim())) {
      return { city: spaced[1].trim(), state: spaced[2].toUpperCase() };
    }
    if (lone.length === 2 && US_STATE_ABBR.has(lone.toUpperCase())) {
      return { state: lone.toUpperCase() };
    }
    return {};
  }
  if (parts.length === 3) {
    const first = parts[0];
    const last = parts[2];
    if (!looksLikePlace(first) || !looksLikePlace(last)) return {};
    return { city: first, state: normalizeGeoToken(last) };
  }
  return {};
}

function asStringArray(value: unknown): string[] {
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

/**
 * TLY from a deal number, Flow deal URL (`/next/deals/TLY-092`, `/cim/TLY-092`),
 * or any string that contains `TLY-digits`. Bare positive integers count as
 * the TLY number (92 → TLY-092), not a database id.
 */
export function parseTlyRef(raw: unknown): string | null {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value) return null;

  const direct = parseCimDealId(value);
  if (direct) return direct;

  const asNumber = Number(value);
  if (/^\d+$/.test(value) && Number.isInteger(asNumber) && asNumber >= 1) {
    return formatDealNumber(asNumber);
  }

  const embedded = value.toUpperCase().match(/TLY-0*(\d+)/);
  if (!embedded) return null;
  const n = Number(embedded[1]);
  if (!Number.isInteger(n) || n < 1) return null;
  return formatDealNumber(n);
}

function packUrlFromBody(body: Record<string, unknown>): unknown {
  const preferred = bodyField(body, "cimUrl", "cim_url", "link", "packUrl", "pack_url");
  if (preferred != null && String(preferred).trim()) return preferred;
  const url = bodyField(body, "url");
  if (url != null && String(url).trim() && !isFlowDealPath(String(url))) return url;
  return undefined;
}

function dealRefFromBody(body: Record<string, unknown>): unknown {
  const preferred = bodyField(
    body,
    "dealNumber",
    "deal_number",
    "dealId",
    "deal_id",
    "deal",
    "dealUrl",
    "deal_url",
  );
  if (preferred != null && String(preferred).trim()) return preferred;
  const url = bodyField(body, "url");
  if (url != null && isFlowDealPath(String(url))) return url;
  return undefined;
}

function isFlowDealPath(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  try {
    const url = new URL(value, "https://web-tau-seven-77.vercel.app");
    const path = url.pathname;
    return /\/next\/deals\//i.test(path) || /^\/cim\//i.test(path);
  } catch {
    return /\/next\/deals\/|\/cim\//i.test(value);
  }
}

/**
 * Pull one or many CIM rows from a POST body.
 * Single object → one item. `{ cims: [...] }`, `{ items: [...] }`, or a
 * top-level array → a batch. Empty / oversized batches are errors.
 */
export function extractCimIntakeItems(
  body: unknown,
): { ok: true; items: Record<string, unknown>[]; batch: boolean } | { ok: false; error: string } {
  if (body == null) return { ok: false, error: "Expected a JSON body." };
  if (Array.isArray(body)) {
    if (body.length === 0) return { ok: false, error: "cims array is empty." };
    if (body.length > CIM_INTAKE_MAX_BATCH) {
      return { ok: false, error: `At most ${CIM_INTAKE_MAX_BATCH} CIMs per request.` };
    }
    if (body.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      return { ok: false, error: "Each CIM must be an object." };
    }
    return { ok: true, items: body as Record<string, unknown>[], batch: true };
  }
  if (typeof body !== "object") return { ok: false, error: "Expected a JSON body." };
  const record = body as Record<string, unknown>;
  const grouped = bodyField(record, "cims", "items");
  if (Array.isArray(grouped)) {
    return extractCimIntakeItems(grouped);
  }
  return { ok: true, items: [record], batch: false };
}

export function parseCimIntakeBody(body: Record<string, unknown>):
  | { ok: true; dealNumber: string; cimUrl: string; patch: CimIntakePatch }
  | { ok: false; error: string } {
  const fileNameRaw = bodyField(body, "fileName", "file_name", "filename");
  const fileName = fileNameRaw == null ? "" : String(fileNameRaw).trim();
  const fromFile = fileName ? parseTlyFromFileName(fileName) : null;
  if (fileName && !fromFile) {
    return { ok: false, error: "fileName must start with TLY-XXX" };
  }

  const dealRef = dealRefFromBody(body);
  const fromDeal = parseTlyRef(dealRef);
  if (dealRef != null && String(dealRef).trim() !== "" && !fromDeal) {
    return { ok: false, error: "dealNumber / dealUrl must include TLY-XXX" };
  }

  if (fromFile && fromDeal && fromFile !== fromDeal) {
    return { ok: false, error: "dealNumber does not match filename TLY" };
  }

  const dealNumber = fromDeal ?? fromFile;
  if (!dealNumber) {
    return { ok: false, error: "Need a dealNumber, dealUrl, or fileName starting with TLY-XXX" };
  }

  const canonical = canonicalCimUrl(
    packUrlFromBody(body) == null ? null : String(packUrlFromBody(body)),
  );
  if (!canonical) {
    return { ok: false, error: "cimUrl must be an https URL." };
  }

  const revenue = parseOptionalMoney(bodyField(body, "revenue"), "revenue");
  const ebitda = parseOptionalMoney(bodyField(body, "ebitda"), "ebitda");
  const asking = parseOptionalMoney(bodyField(body, "asking", "asking_price", "price"), "asking");
  const margin = parseOptionalMargin(bodyField(body, "margin"));
  const cimName = parseOptionalCimName(
    bodyField(body, "cimName", "cim_name", "companyName", "company_name", "headline"),
  );
  const city = parseOptionalGeoField(bodyField(body, "city", "City"), "city");
  const state = parseOptionalGeoField(bodyField(body, "state", "State", "region", "Region"), "state");
  const county = parseOptionalGeoField(bodyField(body, "county", "County"), "county");
  const country = parseOptionalGeoField(bodyField(body, "country", "Country"), "country");
  const fromLocation = parseLocationString(bodyField(body, "location", "Location"));

  if (!revenue.ok) return revenue;
  if (!ebitda.ok) return ebitda;
  if (!asking.ok) return asking;
  if (!margin.ok) return margin;
  if (!cimName.ok) return cimName;
  if (!city.ok) return city;
  if (!state.ok) return state;
  if (!county.ok) return county;
  if (!country.ok) return country;

  const patch: CimIntakePatch = {};
  if (revenue.value !== undefined) patch.revenue = revenue.value;
  if (ebitda.value !== undefined) patch.ebitda = ebitda.value;
  if (asking.value !== undefined) patch.asking = asking.value;
  if (margin.value !== undefined) patch.margin = margin.value;
  if (cimName.value !== undefined) patch.cimName = cimName.value;
  // Explicit city/state win. `location` fills gaps only. No country column —
  // foreign HQ (`country`, e.g. Bermuda) maps to state when state is omitted.
  if (city.value !== undefined) patch.city = city.value;
  else if (fromLocation.city) patch.city = fromLocation.city;
  if (state.value !== undefined) patch.state = state.value;
  else if (fromLocation.state) patch.state = fromLocation.state;
  else if (country.value !== undefined) patch.state = country.value;
  if (county.value !== undefined) patch.county = county.value;
  else if (fromLocation.county) patch.county = fromLocation.county;

  return { ok: true, dealNumber, cimUrl: canonical, patch };
}

async function applyIntakeRow(
  q: QueryFn,
  dealNumber: string,
  cimUrl: string,
  patch: CimIntakePatch,
  actor: string = CIM_INTAKE_ACTOR,
): Promise<{ id: number } | { error: string; status: number }> {
  const rows = await q<{
    id: number;
    stage: string;
    title: string;
    alias_names: unknown;
  }>(
    `SELECT id, stage, title, alias_names FROM deals_next WHERE deal_number = $1 FOR UPDATE`,
    [dealNumber],
  );
  if (rows.length === 0) {
    return { error: "Deal not found.", status: 404 };
  }
  const row = rows[0];
  const from = coerceNextStage(row.stage);
  const advance = shouldAdvanceToCimOnPack(from);
  const dest: NextStageId = advance ? "cim" : from;
  const nextAction = nextActionAfterCimPack(dest, null);
  const cimName = patch.cimName?.trim() || null;
  const aliases = cimName
    ? mergeAliasNames(asStringArray(row.alias_names), cimName, row.title)
    : null;
  const city = patch.city?.trim() || null;
  const state = patch.state?.trim() || null;
  const county = patch.county?.trim() || null;

  await q(
    `UPDATE deals_next
        SET cim_url = $1,
            revenue = COALESCE($2, revenue),
            ebitda = COALESCE($3, ebitda),
            margin = COALESCE($4, margin),
            asking = COALESCE($5, asking),
            cim_name = COALESCE($6, cim_name),
            alias_names = COALESCE($7::jsonb, alias_names),
            city = COALESCE($8, city),
            state = COALESCE($9, state),
            county = COALESCE($10, county),
            stage = CASE WHEN $14::text = 'cim' THEN 'cim' ELSE stage END,
            stage_changed_at = CASE
              WHEN $14::text = 'cim' AND stage IS DISTINCT FROM 'cim' THEN now()
              ELSE stage_changed_at
            END,
            stage_changed_by = CASE
              WHEN $14::text = 'cim' AND stage IS DISTINCT FROM 'cim' THEN $11
              ELSE stage_changed_by
            END,
            next_action = CASE
              WHEN next_action ILIKE '%await%cim%' OR next_action ILIKE '%data room%' THEN $12::text
              WHEN $12::text IS NULL THEN next_action
              WHEN next_action IS NULL THEN $12::text
              WHEN $14::text = 'cim' AND next_action IN ('Sign the NDA', 'Request NDA', 'Review the card') THEN $12::text
              ELSE next_action
            END,
            updated_at = now()
      WHERE id = $13`,
    [
      cimUrl,
      patch.revenue ?? null,
      patch.ebitda ?? null,
      patch.margin ?? null,
      patch.asking ?? null,
      cimName,
      aliases ? JSON.stringify(aliases) : null,
      city,
      state,
      county,
      actor,
      nextAction,
      row.id,
      dest,
    ],
  );

  const intakePatch: Record<string, unknown> = { cim_url: { new: cimUrl } };
  if (patch.revenue != null) intakePatch.revenue = { new: patch.revenue };
  if (patch.ebitda != null) intakePatch.ebitda = { new: patch.ebitda };
  if (patch.margin != null) intakePatch.margin = { new: patch.margin };
  if (patch.asking != null) intakePatch.asking = { new: patch.asking };
  if (cimName) intakePatch.cim_name = { new: cimName };
  if (city) intakePatch.city = { new: city };
  if (state) intakePatch.state = { new: state };
  if (county) intakePatch.county = { new: county };
  await q(
    `INSERT INTO deal_log (deal_id, deal_number, actor, kind, patch, reason, channel)
     VALUES ($1, $2, $3, 'update', $4::jsonb, $5, 'api:next/cim-intake')`,
    [row.id, dealNumber, actor, JSON.stringify(intakePatch), "CIM intake"],
  );

  if (advance && from !== "cim") {
    await q(
      `INSERT INTO deal_log (deal_id, deal_number, actor, kind, patch, channel)
       VALUES ($1, $2, $3, 'stage', $4::jsonb, 'api:next/cim-intake')`,
      [row.id, dealNumber, actor, JSON.stringify({ stage: { old: from, new: "cim" } })],
    );
    const kind = nextFollowupKind("cim");
    if (kind) {
      await q(
        `UPDATE deals_next
            SET watches = watches || $2::jsonb, updated_at = now()
          WHERE id = $1
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(watches) AS w(value)
               WHERE w.value->>'kind' = $3 AND w.value->>'status' = 'open'
            )`,
        [
          row.id,
          JSON.stringify([
            {
              kind,
              status: "open",
              armed_by: actor,
              armed_at: new Date().toISOString(),
              due_at: null,
              note: null,
            },
          ]),
          kind,
        ],
      );
    }
  }

  return { id: Number(row.id) };
}

/**
 * Token-only CIM intake. Updates the existing TLY row in one transaction:
 * cim_url + provided financials + optional cim_name + optional city/state + stage CIM
 * (closed stays closed; pursuing stays past CIM). Never inserts a deal or a vote.
 * Never matches on title. Never talks to Google. Never clears cim_url.
 * When cimName is present, title (teaser) is left in place and cim_name is set.
 * Omitted geo fields leave existing city/state/county alone. There is no
 * deals_next.country column — optional `country` writes `state` when state is omitted.
 */
async function stampParsedIntake(
  body: Record<string, unknown>,
  actor: string,
): Promise<AuthorizedCimIntakeResult> {
  const parsed = parseCimIntakeBody(body);
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };

  const applied = await withTransaction(async (q) =>
    applyIntakeRow(q, parsed.dealNumber, parsed.cimUrl, parsed.patch, actor),
  );
  if ("error" in applied) {
    return { ok: false, error: applied.error, status: applied.status };
  }

  const deal = await getNextDeal(applied.id);
  if (!deal) {
    return { ok: false, error: "Deal not found.", status: 404 };
  }

  return {
    ok: true,
    dealId: deal.id,
    dealNumber: deal.deal_number,
    stage: deal.stage,
    cimUrl: deal.cim_url ?? parsed.cimUrl,
    revenue: deal.revenue,
    ebitda: deal.ebitda,
    margin: deal.margin,
    asking: deal.asking,
    cimName: deal.cim_name,
    city: deal.city,
    state: deal.state,
    county: deal.county,
    deal,
  };
}

export async function applyAuthorizedCimIntake(
  input: AuthorizedCimIntakeInput,
): Promise<AuthorizedCimIntakeResult> {
  const actor = resolveMachineActor(input.authorization);
  if (!actor) {
    return { ok: false, error: "Unauthorized.", status: 401 };
  }
  return stampParsedIntake({ ...input }, actor);
}

export type CimIntakeBatchItemResult = AuthorizedCimIntakeResult & { index: number };

export type AuthorizedCimIntakeBatchResult =
  | {
      ok: true;
      applied: number;
      failed: number;
      results: CimIntakeBatchItemResult[];
    }
  | { ok: false; error: string; status: number };

/**
 * Stamp many packs in one POST. Each item is its own transaction — one
 * unknown TLY does not roll back the rest. Token is checked once.
 */
export async function applyAuthorizedCimIntakeBatch(input: {
  authorization: string | null;
  items: Record<string, unknown>[];
}): Promise<AuthorizedCimIntakeBatchResult> {
  const actor = resolveMachineActor(input.authorization);
  if (!actor) {
    return { ok: false, error: "Unauthorized.", status: 401 };
  }
  const results: CimIntakeBatchItemResult[] = [];
  for (let index = 0; index < input.items.length; index += 1) {
    const stamped = await stampParsedIntake(input.items[index] ?? {}, actor);
    results.push({ index, ...stamped });
  }
  return {
    ok: true,
    applied: results.filter((row) => row.ok).length,
    failed: results.filter((row) => !row.ok).length,
    results,
  };
}

export function publicCimIntakeResult(result: AuthorizedCimIntakeResult) {
  if (!result.ok) return { ok: false as const, error: result.error };
  return {
    ok: true as const,
    dealId: result.dealId,
    dealNumber: result.dealNumber,
    stage: result.stage,
    cimUrl: result.cimUrl,
    revenue: result.revenue,
    ebitda: result.ebitda,
    margin: result.margin,
    asking: result.asking,
    cimName: result.cimName,
    city: result.city,
    state: result.state,
    county: result.county,
  };
}
