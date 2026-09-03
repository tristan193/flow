import { canonicalDriveFileUrl, isDriveFolderUrl, parseCimDealId } from "../cim-pack-id";
import { type QueryFn, withTransaction } from "../db";
import { importTokenValid } from "../import-auth";
import { parseOptionalMargin, parseOptionalMoney } from "./cim-financials-auth";
import { getNextDeal } from "./deals";
import { formatDealNumber, mergeAliasNames, parseDealNumber } from "./identity";
import { type NextDeal, coerceNextStage, defaultNextAction, nextFollowupKind } from "./model";

/** Machine actor for token-driven CIM intake (same family as /api/next/stage). */
export const CIM_INTAKE_ACTOR = "dirk";

export type CimIntakePatch = {
  revenue?: number;
  ebitda?: number;
  margin?: number;
  asking?: number;
  /** CIM company / project / nickname. Omitted when Simon did not send one. */
  cimName?: string;
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
}

export type AuthorizedCimIntakeResult =
  | {
      ok: true;
      dealId: number;
      dealNumber: string;
      stage: "cim";
      cimUrl: string;
      revenue: number | null;
      ebitda: number | null;
      margin: number | null;
      asking: number | null;
      cimName: string | null;
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

  if (!revenue.ok) return revenue;
  if (!ebitda.ok) return ebitda;
  if (!asking.ok) return asking;
  if (!margin.ok) return margin;
  if (!cimName.ok) return cimName;

  const patch: CimIntakePatch = {};
  if (revenue.value !== undefined) patch.revenue = revenue.value;
  if (ebitda.value !== undefined) patch.ebitda = ebitda.value;
  if (asking.value !== undefined) patch.asking = asking.value;
  if (margin.value !== undefined) patch.margin = margin.value;
  if (cimName.value !== undefined) patch.cimName = cimName.value;

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
  const nextAction = defaultNextAction("cim");
  const cimName = patch.cimName?.trim() || null;
  const aliases = cimName
    ? mergeAliasNames(asStringArray(row.alias_names), cimName, row.title)
    : null;

  await q(
    `UPDATE deals_next
        SET cim_url = $1,
            revenue = COALESCE($2, revenue),
            ebitda = COALESCE($3, ebitda),
            margin = COALESCE($4, margin),
            asking = COALESCE($5, asking),
            cim_name = COALESCE($6, cim_name),
            alias_names = COALESCE($7::jsonb, alias_names),
            stage = 'cim',
            stage_changed_at = CASE WHEN stage IS DISTINCT FROM 'cim' THEN now() ELSE stage_changed_at END,
            stage_changed_by = CASE WHEN stage IS DISTINCT FROM 'cim' THEN $8 ELSE stage_changed_by END,
            next_action = COALESCE(next_action, $9),
            updated_at = now()
      WHERE id = $10`,
    [
      cimUrl,
      patch.revenue ?? null,
      patch.ebitda ?? null,
      patch.margin ?? null,
      patch.asking ?? null,
      cimName,
      aliases ? JSON.stringify(aliases) : null,
      actor,
      nextAction,
      row.id,
    ],
  );

  if (from !== "cim") {
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
 * cim_url + provided financials + optional cim_name + stage CIM.
 * Never inserts a deal or a vote. Never matches on title. Never talks to Google.
 * When cimName is present, title (teaser) is left in place and cim_name is set.
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
    stage: "cim",
    cimUrl: deal.cim_url ?? parsed.cimUrl,
    revenue: deal.revenue,
    ebitda: deal.ebitda,
    margin: deal.margin,
    asking: deal.asking,
    cimName: deal.cim_name,
    deal,
  };
}
