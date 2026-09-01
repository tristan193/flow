import { NextResponse, type NextRequest } from "next/server";

import { ensureReady } from "@/lib/boot";
import { importTokenValid } from "@/lib/import-auth";
import { importNextSnapshot } from "@/lib/next/import";
import { collapseNextDuplicates } from "@/lib/next/merge";

/**
 * Machine endpoint for the Next / Dirk loop.
 * Does not write to the live `deals` table or `/api/import`.
 *
 * Authenticated with FLOW_IMPORT_TOKEN (same bearer as live harvest).
 *
 * Collapse raced duplicates (no browser session):
 *   { "mergeDuplicates": true, "deals": [] }
 */

export async function POST(request: NextRequest) {
  if (!importTokenValid(request.headers.get("authorization"))) {
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
    ? await collapseNextDuplicates({
        keepDealNumbers: (payload as { keepDealNumbers?: string[] }).keepDealNumbers,
        deleteDealNumbers: (payload as { deleteDealNumbers?: string[] }).deleteDealNumbers,
        pairs: (payload as { pairs?: { keep: string; delete: string[] }[] }).pairs,
        dryRun: Boolean((payload as { dryRun?: unknown }).dryRun),
      })
    : null;

  if (!hasDeals && !hasVerdicts) {
    return NextResponse.json({ ok: true, merge });
  }

  const result = await importNextSnapshot(
    payload,
    "dirk",
    String((payload as { sourceDb?: string }).sourceDb ?? "api"),
  );
  return NextResponse.json({ ok: true, ...result, ...(merge ? { merge } : {}) });
}
