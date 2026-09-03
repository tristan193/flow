import { test } from "node:test";
import assert from "node:assert/strict";

import { combineNextReview, memberLabel, nextInboxDeck, type VerdictAction } from "./model.ts";

type Action = VerdictAction | null;

const MATRIX: Array<{
  name: string;
  tristan: Action;
  partner: Action;
  superLiked?: boolean;
  want: "inbox" | "shortlist" | "closed";
}> = [
  { name: "neither voted", tristan: null, partner: null, want: "inbox" },
  { name: "Tristan Pass only", tristan: "pass", partner: null, want: "inbox" },
  { name: "Jim Pass only", tristan: null, partner: "pass", want: "inbox" },
  { name: "Tristan ? only", tristan: "discuss", partner: null, want: "inbox" },
  { name: "Jim ? only", tristan: null, partner: "discuss", want: "inbox" },
  { name: "Tristan Like only", tristan: "short", partner: null, want: "shortlist" },
  { name: "Jim Like only", tristan: null, partner: "short", want: "shortlist" },
  { name: "Super Like, no verdicts", tristan: null, partner: null, superLiked: true, want: "shortlist" },
  { name: "Super Like after Tristan Pass", tristan: "pass", partner: null, superLiked: true, want: "shortlist" },
  { name: "both Pass", tristan: "pass", partner: "pass", want: "closed" },
  { name: "Pass + ?", tristan: "pass", partner: "discuss", want: "closed" },
  { name: "? + Pass", tristan: "discuss", partner: "pass", want: "closed" },
  { name: "both ?", tristan: "discuss", partner: "discuss", want: "shortlist" },
  { name: "Pass + Like", tristan: "pass", partner: "short", want: "shortlist" },
  { name: "Like + Pass", tristan: "short", partner: "pass", want: "shortlist" },
  { name: "? + Like", tristan: "discuss", partner: "short", want: "shortlist" },
  { name: "Like + ?", tristan: "short", partner: "discuss", want: "shortlist" },
  { name: "both Like", tristan: "short", partner: "short", want: "shortlist" },
  { name: "both Pass but Super Liked", tristan: "pass", partner: "pass", superLiked: true, want: "shortlist" },
];

test("combineNextReview covers the parallel-deck matrix", () => {
  for (const row of MATRIX) {
    assert.equal(
      combineNextReview({
        tristan: row.tristan,
        partner: row.partner,
        superLiked: row.superLiked,
      }),
      row.want,
      row.name,
    );
  }
});

test("partner Review identity is Jim Evans (id stays partner)", () => {
  if (!process.env.FLOW_MEMBER_PARTNER_LABEL) {
    assert.equal(memberLabel("partner"), "Jim Evans");
  }
  assert.notEqual(memberLabel("tristan"), memberLabel("partner"));
});

test("nextInboxDeck is per-member — partner Pass does not hide Tristan's card", () => {
  const deals = [
    {
      id: 1,
      stage: "inbox",
      verdicts: { partner: { action: "pass" as const } },
    },
    {
      id: 2,
      stage: "inbox",
      verdicts: { tristan: { action: "pass" as const } },
    },
    {
      id: 3,
      stage: "shortlist",
      verdicts: { tristan: { action: "short" as const } },
    },
  ];
  assert.deepEqual(
    nextInboxDeck(deals, "tristan").map((row) => row.id),
    [1],
  );
  assert.deepEqual(
    nextInboxDeck(deals, "partner").map((row) => row.id),
    [2],
  );
});
