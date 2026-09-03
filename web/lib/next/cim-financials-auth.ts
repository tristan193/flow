import { query, queryOne } from "../db";
import { importTokenValid } from "../import-auth";
import { findNextDealRef } from "./stage-auth";

export type CimFinancialsPatch = {
  revenue?: number;
  ebitda?: number;
  margin?: number;
  asking?: number;
};

export interface AuthorizedCimFinancialsInput {
  authorization: string | null;
  dealId?: number | string | null;
  dealNumber?: string | null;
  revenue?: unknown;
  ebitda?: unknown;
  margin?: unknown;
  asking?: unknown;
}

export type AuthorizedCimFinancialsResult =
  | {
      ok: true;
      dealId: number;
      dealNumber: string;
      revenue: number | null;
      ebitda: number | null;
      margin: number | null;
      asking: number | null;
      stage: string;
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

export function parseOptionalMoney(
  raw: unknown,
  label: string,
): { ok: true; value?: number } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true };
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${label} must be a non-negative number` };
  return { ok: true, value: n };
}

/** Ratio 0–1, or percent > 1 (22 → 0.22). */
export function parseOptionalMargin(
  raw: unknown,
): { ok: true; value?: number } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true };
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[%\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "margin must be a non-negative number" };
  return { ok: true, value: n > 1 ? n / 100 : n };
}

export function parseCimFinancialsPatch(body: Record<string, unknown>):
  | { ok: true; dealId?: number | string; dealNumber?: string; patch: CimFinancialsPatch }
  | { ok: false; error: string } {
  const dealNumberRaw = bodyField(body, "dealNumber", "deal_number");
  const dealNumber =
    dealNumberRaw == null || dealNumberRaw === ""
      ? undefined
      : String(dealNumberRaw).trim().toUpperCase();
  const dealId = bodyField(body, "dealId", "deal_id");

  if (dealId == null && !dealNumber) {
    return { ok: false, error: "dealId or dealNumber required" };
  }
  if (dealNumber && !/^TLY-\d+$/i.test(dealNumber)) {
    return { ok: false, error: "dealNumber (TLY-XXX) is required" };
  }

  const revenue = parseOptionalMoney(bodyField(body, "revenue"), "revenue");
  const ebitda = parseOptionalMoney(bodyField(body, "ebitda"), "ebitda");
  const asking = parseOptionalMoney(bodyField(body, "asking", "asking_price", "price"), "asking");
  const margin = parseOptionalMargin(bodyField(body, "margin"));

  if (!revenue.ok) return revenue;
  if (!ebitda.ok) return ebitda;
  if (!asking.ok) return asking;
  if (!margin.ok) return margin;

  const patch: CimFinancialsPatch = {};
  if (revenue.value !== undefined) patch.revenue = revenue.value;
  if (ebitda.value !== undefined) patch.ebitda = ebitda.value;
  if (asking.value !== undefined) patch.asking = asking.value;
  if (margin.value !== undefined) patch.margin = margin.value;

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "at least one of revenue, ebitda, margin, asking is required" };
  }
  return {
    ok: true,
    dealId: dealId as number | string | undefined,
    dealNumber,
    patch,
  };
}

/**
 * Token-only write of CIM pack numbers onto deals_next.
 * Reuses revenue / ebitda / asking / margin. Never writes stage.
 * Browser session is not enough — Dirk uses FLOW_IMPORT_TOKEN.
 */
export async function applyAuthorizedCimFinancials(
  input: AuthorizedCimFinancialsInput,
): Promise<AuthorizedCimFinancialsResult> {
  if (!importTokenValid(input.authorization)) {
    return { ok: false, error: "Unauthorized.", status: 401 };
  }

  const parsed = parseCimFinancialsPatch({
    dealId: input.dealId,
    dealNumber: input.dealNumber,
    revenue: input.revenue,
    ebitda: input.ebitda,
    margin: input.margin,
    asking: input.asking,
  });
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 };

  const ref = await findNextDealRef({ dealId: parsed.dealId, dealNumber: parsed.dealNumber });
  if (!ref) {
    return { ok: false, error: "Deal not found.", status: 404 };
  }

  await query(
    `UPDATE deals_next
        SET revenue = COALESCE($1, revenue),
            ebitda = COALESCE($2, ebitda),
            margin = COALESCE($3, margin),
            asking = COALESCE($4, asking),
            updated_at = now()
      WHERE id = $5`,
    [
      parsed.patch.revenue ?? null,
      parsed.patch.ebitda ?? null,
      parsed.patch.margin ?? null,
      parsed.patch.asking ?? null,
      ref.id,
    ],
  );

  const row = await queryOne<{
    deal_number: string;
    revenue: number | null;
    ebitda: number | null;
    margin: number | null;
    asking: number | null;
    stage: string;
  }>(
    `SELECT deal_number, revenue, ebitda, margin, asking, stage
       FROM deals_next
      WHERE id = $1`,
    [ref.id],
  );

  return {
    ok: true,
    dealId: ref.id,
    dealNumber: String(row?.deal_number ?? ref.dealNumber),
    revenue: row?.revenue == null ? null : Number(row.revenue),
    ebitda: row?.ebitda == null ? null : Number(row.ebitda),
    margin: row?.margin == null ? null : Number(row.margin),
    asking: row?.asking == null ? null : Number(row.asking),
    stage: String(row?.stage ?? ""),
  };
}
