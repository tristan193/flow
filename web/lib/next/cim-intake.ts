import { canonicalDriveFileUrl, isDriveFolderUrl, parseCimDealId } from "../cim-pack-id";
import { type QueryFn, withTransaction } from "../db";
import { importTokenValid } from "../import-auth";
import { parseOptionalMargin, parseOptionalMoney } from "./cim-financials-auth";
import { getNextDeal } from "./deals";
import { formatDealNumber, mergeAliasNames, parseDealNumber } from "./identity";
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

export interface AuthorizedCimIntakeInput {
  authorization: string | null;
  fileName?: unknown;
  file_name?: unknown;
  cimUrl?: unknown;
  cim_url?: unknown;
  dealNumber?: unknown;
  deal_number?: unknown;
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

export function parseCimIntakeBody(body: Record<string, unknown>):
  | { ok: true; dealNumber: string; cimUrl: string; patch: CimIntakePatch }
  | { ok: false; error: string } {
  const fileNameRaw = bodyField(body, "fileName", "file_name", "filename");
  const fileName = fileNameRaw == null ? "" : String(fileNameRaw).trim();
  if (!fileName) return { ok: false, error: "fileName is required" };

  const fromFile = parseTlyFromFileName(fileName);
  if (!fromFile) {
    return { ok: false, error: "fileName must start with TLY-XXX" };
  }

  const dealNumberRaw = bodyField(body, "dealNumber", "deal_number");
  if (dealNumberRaw != null && dealNumberRaw !== "") {
    const posted = parseCimDealId(String(dealNumberRaw)) ?? (parseDealNumber(String(dealNumberRaw))
      ? formatDealNumber(parseDealNumber(String(dealNumberRaw))!)
      : null);
    if (!posted) return { ok: false, error: "dealNumber must be TLY-XXX" };
    if (posted !== fromFile) {
      return { ok: false, error: "dealNumber does not match filename TLY" };
    }
  }

  const cimUrlRaw = bodyField(body, "cimUrl", "cim_url");
  const canonical = canonicalDriveFileUrl(cimUrlRaw == null ? null : String(cimUrlRaw));
  if (!canonical || isDriveFolderUrl(cimUrlRaw == null ? null : String(cimUrlRaw))) {
    return { ok: false, error: "cimUrl must be a Google Drive file URL." };
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

  return { ok: true, dealNumber: fromFile, cimUrl: canonical, patch };
}

async function applyIntakeRow(
  q: QueryFn,
  dealNumber: string,
  cimUrl: string,
  patch: CimIntakePatch,
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
  const actor = CIM_INTAKE_ACTOR;
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

  if (advance && from !== "cim") {
    await q(
      `INSERT INTO stage_events_next (deal_id, from_stage, to_stage, member)
       VALUES ($1, $2, $3, $4)`,
      [row.id, from, "cim", actor],
    );
    const kind = nextFollowupKind("cim");
    if (kind) {
      await q(
        `INSERT INTO next_followups (deal_id, kind, status, armed_by)
         SELECT $1, $2, 'open', $3
          WHERE NOT EXISTS (
            SELECT 1 FROM next_followups
             WHERE deal_id = $1 AND kind = $2 AND status = 'open'
          )`,
        [row.id, kind, actor],
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
export async function applyAuthorizedCimIntake(
  input: AuthorizedCimIntakeInput,
): Promise<AuthorizedCimIntakeResult> {
  if (!importTokenValid(input.authorization)) {
    return { ok: false, error: "Unauthorized.", status: 401 };
  }

  const parsed = parseCimIntakeBody({
    fileName: input.fileName,
    file_name: input.file_name,
    cimUrl: input.cimUrl,
    cim_url: input.cim_url,
    dealNumber: input.dealNumber,
    deal_number: input.deal_number,
    revenue: input.revenue,
    ebitda: input.ebitda,
    margin: input.margin,
    asking: input.asking,
    asking_price: input.asking_price,
    price: input.price,
    cimName: input.cimName,
    cim_name: input.cim_name,
    companyName: input.companyName,
    company_name: input.company_name,
    headline: input.headline,
    city: input.city,
    City: input.City,
    state: input.state,
    State: input.State,
    region: input.region,
    Region: input.Region,
    county: input.county,
    County: input.County,
    country: input.country,
    Country: input.Country,
    location: input.location,
    Location: input.Location,
  });
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };

  const applied = await withTransaction(async (q) =>
    applyIntakeRow(q, parsed.dealNumber, parsed.cimUrl, parsed.patch),
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
