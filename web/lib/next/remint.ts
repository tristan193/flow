/**
 * Structured remint / attach-only ingest.
 *
 * Harve (Gmail) sometimes joins a mid-pipeline teaser to an existing TLY
 * (Life-Safety thread → TLY-132). That decision used to live only in free-text
 * `blurb`. Flow now takes explicit fields on POST /api/next/import:
 *
 *   duplicateOf        string | null   canonical deal number, e.g. "TLY-132"
 *   ingestDisposition  "new" | "attached" | "remint" | null
 *
 * Contract:
 *   1. If duplicateOf points at an existing deals_next row, OR disposition is
 *      attached/remint and identity matches that row: attach-only.
 *      Merge gmailThreadIds, aliasNames, and sourceIds onto the canonical
 *      deal. Do not mint a Review card. Do not change stage, title, blurb,
 *      or money on the canonical row.
 *   2. If a remint/attach payload cannot join (unknown duplicateOf, or
 *      disposition remint/attached with no match): mint a Closed audit row
 *      with duplicate_of / ingest_disposition set so it never sits in Review.
 *   3. If Harve also posts a different dealNumber that already exists (an
 *      accidental remint card), that row is stamped + Closed.
 *   4. `blurb` stays human notes. Review / import must not parse English
 *      to decide "is this a duplicate?"
 *
 * Harvest POST /api/import maps these through when the snapshot carries them.
 */

import { formatDealNumber, parseDealNumber } from "./identity";

export const NEXT_INGEST_DISPOSITIONS = ["new", "attached", "remint"] as const;
export type NextIngestDisposition = (typeof NEXT_INGEST_DISPOSITIONS)[number];

export function parseIngestDisposition(value: unknown): NextIngestDisposition | null {
  const t = String(value ?? "")
    .trim()
    .toLowerCase();
  if (t === "attach") return "attached";
  if (t === "duplicate" || t === "dupe") return "remint";
  if (t === "new" || t === "attached" || t === "remint") return t;
  return null;
}

/** Canonical TLY-NNN, or null if the value is not a deal number. */
export function formatDuplicateOf(value: unknown): string | null {
  if (value == null || value === "") return null;
  const n = parseDealNumber(String(value));
  return n ? formatDealNumber(n) : null;
}

export function isNextRemintCard(deal: {
  duplicate_of?: string | null;
  ingest_disposition?: string | null;
}): boolean {
  const disp = parseIngestDisposition(deal.ingest_disposition);
  if (disp === "remint" || disp === "attached") return true;
  return formatDuplicateOf(deal.duplicate_of) != null;
}

export function isAttachOnlyIngest(input: {
  duplicateOf?: string | null;
  duplicate_of?: string | null;
  ingestDisposition?: string | null;
  ingest_disposition?: string | null;
}): boolean {
  const disp = parseIngestDisposition(input.ingestDisposition ?? input.ingest_disposition);
  if (disp === "remint" || disp === "attached") return true;
  return formatDuplicateOf(input.duplicateOf ?? input.duplicate_of) != null;
}
