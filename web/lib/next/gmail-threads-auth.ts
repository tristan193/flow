import { resolveMachineActor } from "../actors";
import { queryOne } from "../db";
import { extractGmailThreadId } from "../gmail-thread";
import { applyDealChange } from "./change-log";
import { asStringArray, mergeThreadIds, parseDealNumber, uniqueStrings } from "./identity";
import { findNextDealRef } from "./stage-auth";

export type GmailThreadWriteMode = "replace" | "prepend" | "append";

export interface AuthorizedGmailThreadsInput {
  authorization: string | null;
  dealId?: number | string | null;
  dealNumber?: string | null;
  mode?: string | null;
  gmailThreadIds?: unknown;
}

export type AuthorizedGmailThreadsResult =
  | { ok: true; dealNumber: string; gmailThreadIds: string[] }
  | { ok: false; error: string; status: number };

const MODES = new Set<GmailThreadWriteMode>(["replace", "prepend", "append"]);

/**
 * Ordered thread ids for one card.
 * replace: the incoming list, exactly (deduped, empty clears).
 * prepend: incoming first, then ids already on the card.
 * append: same union as import / merge (`mergeThreadIds`).
 */
export function orderGmailThreadIds(
  existing: string[] | null | undefined,
  incoming: string[],
  mode: GmailThreadWriteMode,
): string[] {
  if (mode === "replace") return uniqueStrings(incoming);
  if (mode === "prepend") return uniqueStrings([...incoming, ...(existing || [])]);
  return mergeThreadIds(existing, incoming);
}

/** Bare Gmail thread ids, or a mail URL reduced to its thread id. Order kept. */
export function normalizeGmailThreadIds(
  raw: unknown,
): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "gmailThreadIds must be an array of thread ids." };
  }
  const extracted: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      return { ok: false, error: "gmailThreadIds must be an array of thread ids." };
    }
    const id = extractGmailThreadId(item);
    if (!id) return { ok: false, error: "gmailThreadIds must be Gmail thread ids." };
    extracted.push(id);
  }
  return { ok: true, ids: uniqueStrings(extracted) };
}

function parseMode(raw: string | null | undefined): GmailThreadWriteMode | null {
  const mode = String(raw || "").trim().toLowerCase();
  return MODES.has(mode as GmailThreadWriteMode) ? (mode as GmailThreadWriteMode) : null;
}

/**
 * Token-only write of deals_next.gmail_thread_ids (JSONB string array).
 * Does not touch join keys, aliases, or stage. Browser session is not
 * enough — Dirk uses FLOW_IMPORT_TOKEN (same machine actors as /api/next/merge).
 */
export async function applyAuthorizedGmailThreads(
  input: AuthorizedGmailThreadsInput,
): Promise<AuthorizedGmailThreadsResult> {
  const actor = resolveMachineActor(input.authorization);
  if (!actor) {
    return { ok: false, error: "Unauthorized.", status: 401 };
  }

  const mode = parseMode(input.mode);
  if (!mode) {
    return { ok: false, error: 'mode must be "replace", "prepend", or "append".', status: 400 };
  }

  const normalized = normalizeGmailThreadIds(input.gmailThreadIds);
  if (!normalized.ok) return { ok: false, error: normalized.error, status: 400 };

  const number = input.dealNumber?.trim() || "";
  if (input.dealId == null && !number) {
    return { ok: false, error: "dealNumber is required.", status: 400 };
  }
  if (number && !parseDealNumber(number)) {
    return { ok: false, error: "dealNumber must look like TLY-096.", status: 400 };
  }

  const ref = await findNextDealRef({ dealId: input.dealId, dealNumber: number || null });
  if (!ref) {
    return { ok: false, error: "Deal not found.", status: 404 };
  }

  const before = await queryOne<{ gmail_thread_ids: unknown }>(
    "SELECT gmail_thread_ids FROM deals_next WHERE id = $1",
    [ref.id],
  );
  if (!before) {
    return { ok: false, error: "Deal not found.", status: 404 };
  }

  const next = orderGmailThreadIds(asStringArray(before.gmail_thread_ids), normalized.ids, mode);
  await applyDealChange({
    dealId: ref.id,
    actor,
    kind: "update",
    channel: "api:next/gmail-threads",
    reason: "Gmail thread ids",
    fields: { gmail_thread_ids: next },
  });

  const row = await queryOne<{ deal_number: string; gmail_thread_ids: unknown }>(
    "SELECT deal_number, gmail_thread_ids FROM deals_next WHERE id = $1",
    [ref.id],
  );
  return {
    ok: true,
    dealNumber: String(row?.deal_number ?? ref.dealNumber),
    gmailThreadIds: asStringArray(row?.gmail_thread_ids),
  };
}
