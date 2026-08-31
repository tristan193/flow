/**
 * Buy-box review facts. Learned dislikes / hard-nos stay empty until Tristan
 * edits pipeline/buybox.yaml — never invent them for CIM scoring.
 */

export const BUYBOX_STATUS = "draft" as const;

export const BUYBOX_STATUS_NOTE =
  "Buy box is DRAFT / inferred until Tristan edits pipeline/buybox.yaml. Empty dislike and hard-no lists are empty on purpose — not missing data to fill in.";

/** Learned penalties from yaml `learned.penalties` — starts empty, do not hallucinate. */
export const LEARNED_DISLIKES: Array<{ pattern: string; note?: string }> = [];

/** Extra hard-nos beyond the documented yaml exclusions. None until Tristan writes them. */
export const LEARNED_HARD_NOS: string[] = [];

export function buyboxReviewFacts(): {
  status: typeof BUYBOX_STATUS;
  note: string;
  learnedDislikes: typeof LEARNED_DISLIKES;
  learnedHardNos: typeof LEARNED_HARD_NOS;
} {
  return {
    status: BUYBOX_STATUS,
    note: BUYBOX_STATUS_NOTE,
    learnedDislikes: LEARNED_DISLIKES,
    learnedHardNos: LEARNED_HARD_NOS,
  };
}
