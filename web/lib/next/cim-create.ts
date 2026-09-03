import { MAX_CIM_BYTES } from "../deals";
import { query } from "../db";
import { normalizeAxialHref } from "../playbooks";
import { getNextDeal, moveNextStage, saveNextDealFile } from "./deals";
import { upsertNextDeals, type IncomingNextDeal } from "./import";
import { type MemberId, type NextDeal, coerceNextStage } from "./model";

export { MAX_CIM_BYTES };

const CIM_FROM_STAGES = new Set(["inbox", "shortlist", "nda"]);

export interface NextCimDraft {
  title: string;
  blurb: string | null;
  city: string | null;
  state: string | null;
  revenue: number | null;
  ebitda: number | null;
  sde: number | null;
  asking: number | null;
  businessModelType: string | null;
  url: string | null;
  brokerFirm?: string | null;
}

/**
 * Manual CIM / listing add. Joins an existing TLY on source id or fingerprint
 * when those keys are present; otherwise mints a new number. Lands at CIM so
 * the card never enters Next Review swipe. Gmail harvest does not use this
 * path and still arrives inbound.
 */
export async function createNextDealFromCim(
  member: MemberId,
  draft: NextCimDraft,
  file?: { filename: string; contentType: string; bytes: Uint8Array },
): Promise<NextDeal> {
  const title = draft.title.trim();
  if (!title) throw new Error("Title is required.");

  const url = normalizeAxialHref(draft.url) ?? (draft.url?.trim() || null);
  const needs: string[] = [];
  if (draft.ebitda == null && draft.sde == null) needs.push("earnings");
  if (!draft.state) needs.push("location");

  const incoming: IncomingNextDeal = {
    title,
    blurb: draft.blurb?.trim() || null,
    city: draft.city?.trim() || null,
    state: draft.state?.trim() || null,
    revenue: draft.revenue,
    ebitda: draft.ebitda,
    sde: draft.sde,
    asking: draft.asking,
    businessModelType: draft.businessModelType,
    url,
    html: url,
    source: "manual",
    subSource: member,
    sources: "manual",
    brokerFirm: draft.brokerFirm?.trim() || null,
    aliasNames: [title],
    member,
    needsLlm: needs,
  };

  const result = await upsertNextDeals([incoming]);
  const dealId = result.dealIds[0];
  if (!dealId) throw new Error("Could not create deal.");

  if (result.dealsNew) {
    await query(
      `UPDATE deals_next SET nickname = COALESCE(NULLIF(btrim(nickname), ''), 'Manual')
        WHERE id = $1`,
      [dealId],
    );
  }

  const current = await getNextDeal(dealId);
  if (!current) throw new Error("Deal created but could not reload.");
  if (CIM_FROM_STAGES.has(coerceNextStage(current.stage))) {
    await moveNextStage(dealId, member, "cim");
  }
  // Manual CIM add skips Shortlist — still need the Drive drop folder.
  if (!current.cim_url) {
    const { ensureCimFolderForDeal } = await import("./cim-drive-sync");
    await ensureCimFolderForDeal(dealId);
  }

  if (file) {
    await saveNextDealFile(dealId, member, file, "cim", { moveToCim: false });
  }

  const deal = await getNextDeal(dealId);
  if (!deal) throw new Error("Deal created but could not reload.");
  return deal;
}
