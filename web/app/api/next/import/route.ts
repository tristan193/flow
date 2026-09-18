import { NextResponse, type NextRequest } from "next/server";

import { resolveMachineActor } from "@/lib/actors";
import { ensureReady } from "@/lib/boot";
import { importNextSnapshot } from "@/lib/next/import";
import { collapseNextDuplicates } from "@/lib/next/merge";

/**
 * Machine endpoint for the Next / Dirk loop.
 * Does not write to the live `deals` table or `/api/import`.
 *
 * Authenticated with FLOW_IMPORT_TOKEN (same bearer as live harvest).
 *
 * Remint / attach-only (Harve): each deal may include
 *   duplicateOf: "TLY-132"
 *   ingestDisposition: "new" | "attached" | "remint"
 * Attach-only merges gmailThreadIds onto the canonical TLY and does not mint
 * a Review card. See `web/lib/next/remint.ts`.
 *
 * Collapse raced duplicates (no browser session):
 *   { "mergeDuplicates": true, "deals": [] }
 */

export async function POST(request: NextRequest) {
  const actor = resolveMachineActor(request.headers.get("authorization"));
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await ensureReady();

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const mergeFlag = Boolean(
    (payload as { mergeDuplicates?: unknown; collapseDuplicates?: unknown }).mergeDuplicates ||
      (payload as { collapseDuplicates?: unknown }).collapseDuplicates,
  );
  const hasDeals = Array.isArray((payload as { deals?: unknown }).deals);
  const hasVerdicts = Array.isArray((payload as { verdicts?: unknown }).verdicts);

  if (!hasDeals && !hasVerdicts && !mergeFlag) {
    return NextResponse.json({ error: "Expected a deals array." }, { status: 400 });
  }

  const merge = mergeFlag
    ? await collapseNextDuplicates(
        {
          keepDealNumbers: (payload as { keepDealNumbers?: string[] }).keepDealNumbers,
          deleteDealNumbers: (payload as { deleteDealNumbers?: string[] }).deleteDealNumbers,
          pairs: (payload as { pairs?: { keep: string; delete: string[] }[] }).pairs,
          dryRun: Boolean((payload as { dryRun?: unknown }).dryRun),
        },
        actor,
      )
    : null;

  if (!hasDeals && !hasVerdicts) {
    return NextResponse.json({ ok: true, merge });
  }

  // Agents never cast votes: any verdicts in the payload become needs_review
  // proposals in deal_log, surfaced on /db for a human to confirm.
  const result = await importNextSnapshot(
    payload,
    actor,
    String((payload as { sourceDb?: string }).sourceDb ?? "api"),
    { verdictMode: "propose" },
  );
  return NextResponse.json({ ok: true, ...result, ...(merge ? { merge } : {}) });
}
