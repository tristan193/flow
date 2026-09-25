import { resolveMachineActor } from "../actors";
import { queryOne } from "../db";
import { applyDealChange } from "./change-log";
import { asStringArray, mergeThreadIds, parseDealNumber, uniqueStrings } from "./identity";
import { findNextDealRef } from "./stage-auth";

/**
 * Token write of deals_next.gmail_thread_ids.
 * replace overwrites the JSON array. append/prepend reuse mergeThreadIds order
 * rules and do not touch source_deal_id or blank-fill.
 * Browser session is not enough — Dirk uses FLOW_IMPORT_TOKEN.
 */

export type GmailThreadMode = "replace" | "append" | "prepend";

const MODES = new Set<GmailThreadMode>(["replace", "append", "prepend"]);

export interface AuthorizedGmailThreadsInput {
  authorization: string | null;
  dealNumber?: string | null;
  mode?: string | null;
  gmailThreadIds?: unknown;
}

export type AuthorizedGmailThreadsResult =
  | { ok: true; dealNumber: string; gmailThreadIds: string[] }
  | { ok: false; error: string; status: number };

/** Dedupe case-insensitively, drop blanks, keep first-seen order. */
export function normalizeGmailThreadIds(ids: readonly string[]): string[] {
  return uniqueStrings([...ids]);
}

/**
 * replace sets the column to the incoming list only.
 * append unions onto the end; prepend puts incoming ids first.
 */
export function nextGmailThreadIds(
  existing: string[] | null | undefined,
  incoming: readonly string[],
  mode: GmailThreadMode,
): string[] {
  const next = normalizeGmailThreadIds(incoming);
  if (mode === "replace") return next;
  const current = asStringArray(existing);
  if (mode === "prepend") return uniqueStrings([...next, ...current]);
  return mergeThreadIds(current, next);
}

function parseIds(raw: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "gmailThreadIds must be an array of strings." };
  }
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      return { ok: false, error: "gmailThreadIds must be an array of strings." };
    }
    ids.push(item);
  }
  return { ok: true, ids };
}

export async function applyAuthorizedGmailThreads(
  input: AuthorizedGmailThreadsInput,
): Promise<AuthorizedGmailThreadsResult> {
  const actor = resolveMachineActor(input.authorization);
  if (!actor) {
    return { ok: false, error: "Unauthorized.", status: 401 };
  }

  const dealNumber = input.dealNumber?.trim().toUpperCase() || "";
  if (!dealNumber || !parseDealNumber(dealNumber)) {
    return { ok: false, error: "dealNumber (TLY-XXX) is required.", status: 400 };
  }

  const mode = (input.mode || "").trim().toLowerCase();
  if (!MODES.has(mode as GmailThreadMode)) {
    return {
      ok: false,
      error: 'mode must be "replace", "append", or "prepend".',
      status: 400,
    };
  }

  const parsedIds = parseIds(input.gmailThreadIds);
  if (!parsedIds.ok) return { ok: false, error: parsedIds.error, status: 400 };

  const ref = await findNextDealRef({ dealNumber });
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

  const gmailThreadIds = nextGmailThreadIds(
    asStringArray(before.gmail_thread_ids),
    parsedIds.ids,
    mode as GmailThreadMode,
  );

  await applyDealChange({
    dealId: ref.id,
    actor,
    kind: "update",
    channel: "api:next/gmail-threads",
    reason: mode === "replace" ? "Replace Gmail thread ids" : `Gmail thread ids ${mode}`,
    fields: { gmail_thread_ids: gmailThreadIds },
  });

  const after = await queryOne<{ deal_number: string; gmail_thread_ids: unknown }>(
    "SELECT deal_number, gmail_thread_ids FROM deals_next WHERE id = $1",
    [ref.id],
  );
  if (!after) {
    return { ok: false, error: "Deal not found.", status: 404 };
  }

  return {
    ok: true,
    dealNumber: String(after.deal_number),
    gmailThreadIds: asStringArray(after.gmail_thread_ids),
  };
}
