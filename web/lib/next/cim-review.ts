import { addNextNote, getNextDeal, saveNextCimLink } from "./deals";
import { findNextDealRef } from "./stage-auth";
import { normalizeCimUrl } from "./cim-drive";
import { NEXT_REVIEW_ACTOR, resolveNextWriter } from "./write-auth";

export interface AuthorizedCimWriteInput {
  authorization: string | null;
  sessionMember: string | null;
  dealId?: number | string | null;
  dealNumber?: string | null;
  url?: string | null;
  review?: string | null;
  body?: string | null;
  actor?: string | null;
}

export type AuthorizedCimWriteResult =
  | {
      ok: true;
      dealId: number;
      dealNumber: string;
      cimUrl: string | null;
      viewUrl: string | null;
      review: string | null;
      actor: string;
    }
  | { ok: false; error: string; status: number };

function reviewBody(input: AuthorizedCimWriteInput): string | null {
  const text = (input.review ?? input.body ?? "").trim();
  return text ? text.slice(0, 4000) : null;
}

/**
 * Token or session can attach a Drive CIM URL. Moves the card to CIM the same
 * way the member JSON path already does. Does not write a verdict.
 */
export async function applyAuthorizedCimLink(
  input: AuthorizedCimWriteInput,
): Promise<AuthorizedCimWriteResult> {
  const who = resolveNextWriter({
    authorization: input.authorization,
    sessionMember: input.sessionMember,
    actor: input.actor,
    tokenDefaultActor: "dirk",
  });
  if (!who.ok) return who;

  const url = normalizeCimUrl(input.url ?? "");
  if (!url) {
    return { ok: false, error: "Need a http(s) CIM URL (Drive folder preferred).", status: 400 };
  }

  const ref = await findNextDealRef({ dealId: input.dealId, dealNumber: input.dealNumber });
  if (!ref) return { ok: false, error: "Deal not found.", status: 404 };

  await saveNextCimLink(ref.id, who.actor, url);
  const deal = await getNextDeal(ref.id);
  return {
    ok: true,
    dealId: ref.id,
    dealNumber: ref.dealNumber,
    cimUrl: deal?.cim_url ?? url,
    viewUrl: deal?.cim_url ?? url,
    review: null,
    actor: who.actor,
  };
}

/**
 * Token notes are Simon's written CIM review — never a Pursue/Pass/Hold vote.
 * Session members still post as themselves (existing /api/next/notes).
 */
export async function applyAuthorizedNextNote(
  input: AuthorizedCimWriteInput,
): Promise<AuthorizedCimWriteResult> {
  const who = resolveNextWriter({
    authorization: input.authorization,
    sessionMember: input.sessionMember,
    actor: input.actor,
    tokenDefaultActor: NEXT_REVIEW_ACTOR,
  });
  if (!who.ok) return who;

  const body = reviewBody(input);
  if (!body) return { ok: false, error: "Need a review body.", status: 400 };

  const ref = await findNextDealRef({ dealId: input.dealId, dealNumber: input.dealNumber });
  if (!ref) return { ok: false, error: "Deal not found.", status: 404 };

  const actor = who.token ? NEXT_REVIEW_ACTOR : who.actor;
  await addNextNote(ref.id, actor, body);
  const deal = await getNextDeal(ref.id);
  return {
    ok: true,
    dealId: ref.id,
    dealNumber: ref.dealNumber,
    cimUrl: deal?.cim_url ?? null,
    viewUrl: deal?.cim_url ?? null,
    review: body,
    actor,
  };
}

/**
 * Dirk/Simon convenience: Drive URL and/or Simon's review in one POST.
 * Never writes a verdict. URL may move the card to CIM; review text does not.
 */
export async function applyAuthorizedCimReview(
  input: AuthorizedCimWriteInput,
): Promise<AuthorizedCimWriteResult> {
  const url = (input.url ?? "").trim();
  const body = reviewBody(input);
  if (!url && !body) {
    return { ok: false, error: "Need a Drive url and/or a review.", status: 400 };
  }

  let cimUrl: string | null = null;
  let viewUrl: string | null = null;
  let actor = NEXT_REVIEW_ACTOR;

  if (url) {
    const linked = await applyAuthorizedCimLink(input);
    if (!linked.ok) return linked;
    cimUrl = linked.cimUrl;
    viewUrl = linked.viewUrl ?? linked.cimUrl;
    actor = linked.actor;
  }

  if (body) {
    const noted = await applyAuthorizedNextNote({
      ...input,
      actor: input.actor || NEXT_REVIEW_ACTOR,
    });
    if (!noted.ok) return noted;
    return {
      ...noted,
      cimUrl: noted.cimUrl ?? cimUrl,
      viewUrl: noted.viewUrl ?? viewUrl ?? noted.cimUrl ?? cimUrl,
    };
  }

  const ref = await findNextDealRef({ dealId: input.dealId, dealNumber: input.dealNumber });
  if (!ref) return { ok: false, error: "Deal not found.", status: 404 };
  return {
    ok: true,
    dealId: ref.id,
    dealNumber: ref.dealNumber,
    cimUrl,
    viewUrl: viewUrl ?? cimUrl,
    review: null,
    actor,
  };
}
