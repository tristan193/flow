import { canonicalDriveFileUrl, isDriveFolderUrl, parseCimDealId } from "../cim-pack-id";
import { type QueryFn, withTransaction } from "../db";
import { importTokenValid } from "../import-auth";
import { parseOptionalMargin, parseOptionalMoney } from "./cim-financials-auth";
import { getNextDeal } from "./deals";
import { formatDealNumber, parseDealNumber } from "./identity";
import { type NextDeal, coerceNextStage, defaultNextAction, nextFollowupKind } from "./model";

/** Machine actor for token-driven CIM intake (same family as /api/next/stage). */
export const CIM_INTAKE_ACTOR = "dirk";

export type CimIntakePatch = {
  revenue?: number;
  ebitda?: number;
  margin?: number;
  asking?: number;
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

  if (!revenue.ok) return revenue;
  if (!ebitda.ok) return ebitda;
  if (!asking.ok) return asking;
  if (!margin.ok) return margin;

  const patch: CimIntakePatch = {};
  if (revenue.value !== undefined) patch.revenue = revenue.value;
  if (ebitda.value !== undefined) patch.ebitda = ebitda.value;
  if (asking.value !== undefined) patch.asking = asking.value;
  if (margin.value !== undefined) patch.margin = margin.value;

  return { ok: true, dealNumber: fromFile, cimUrl: canonical, patch };
}

async function applyIntakeRow(
  q: QueryFn,
  dealNumber: string,
  cimUrl: string,
  patch: CimIntakePatch,
): Promise<{ id: number } | { error: string; status: number }> {
  const rows = await q<{ id: number; stage: string }>(
    `SELECT id, stage FROM deals_next WHERE deal_number = $1 FOR UPDATE`,
    [dealNumber],
  );
  if (rows.length === 0) {
    return { error: "Deal not found.", status: 404 };
  }
  const row = rows[0];
  const from = coerceNextStage(row.stage);
  const actor = CIM_INTAKE_ACTOR;
  const nextAction = defaultNextAction("cim");

  await q(
    `UPDATE deals_next
        SET cim_url = $1,
            revenue = COALESCE($2, revenue),
            ebitda = COALESCE($3, ebitda),
            margin = COALESCE($4, margin),
            asking = COALESCE($5, asking),
            stage = 'cim',
            stage_changed_at = CASE WHEN stage IS DISTINCT FROM 'cim' THEN now() ELSE stage_changed_at END,
            stage_changed_by = CASE WHEN stage IS DISTINCT FROM 'cim' THEN $6 ELSE stage_changed_by END,
            next_action = COALESCE(next_action, $7),
            updated_at = now()
      WHERE id = $8`,
    [
      cimUrl,
      patch.revenue ?? null,
      patch.ebitda ?? null,
      patch.margin ?? null,
      patch.asking ?? null,
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
 * cim_url + provided financials + stage CIM. Never inserts a deal or a vote.
 * Never matches on title. Never talks to Google.
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
    deal,
  };
}
