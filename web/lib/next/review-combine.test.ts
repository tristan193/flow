import { test } from "node:test";
import assert from "node:assert/strict";

import {
  combineNextCim,
  combineNextReview,
  isNextCimReviewCard,
  memberLabel,
  nextCimDeck,
  nextInboxDeck,
  partnerNotesOnly,
  type VerdictAction,
} from "./model.ts";

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

test("combineNextCim stays CIM unless both Pass or both Pursue", () => {
  const rows: Array<{
    name: string;
    tristan: Action;
    partner: Action;
    want: "cim" | "pursuing" | "closed";
  }> = [
    { name: "neither", tristan: null, partner: null, want: "cim" },
    { name: "one Pass", tristan: "pass", partner: null, want: "cim" },
    { name: "one Pursue", tristan: "short", partner: null, want: "cim" },
    { name: "one Hold", tristan: "discuss", partner: null, want: "cim" },
    { name: "both Hold", tristan: "discuss", partner: "discuss", want: "cim" },
    { name: "Pass vs Pursue", tristan: "pass", partner: "short", want: "cim" },
    { name: "Pass vs Hold", tristan: "pass", partner: "discuss", want: "cim" },
    { name: "Pursue vs Hold", tristan: "short", partner: "discuss", want: "cim" },
    { name: "both Pass", tristan: "pass", partner: "pass", want: "closed" },
    { name: "both Pursue", tristan: "short", partner: "short", want: "pursuing" },
  ];
  for (const row of rows) {
    assert.equal(
      combineNextCim({ tristan: row.tristan, partner: row.partner }),
      row.want,
      row.name,
    );
  }
});

test("CIM deck includes every stage CIM row; stamped URL still pulls open board rows", () => {
  const file = "https://drive.google.com/file/d/abcFile031/view";
  const folder = "https://drive.google.com/drive/folders/0ABYzLaaJ9ebAUk9PVA";
  assert.equal(isNextCimReviewCard({ stage: "cim", cim_url: null }), true);
  assert.equal(isNextCimReviewCard({ stage: "cim", cim_url: "" }), true);
  assert.equal(isNextCimReviewCard({ stage: "cim", cim_url: folder }), true);
  assert.equal(isNextCimReviewCard({ stage: "cim", cim_url: file }), true);
  assert.equal(isNextCimReviewCard({ stage: "nda", cim_url: file }), true);
  assert.equal(isNextCimReviewCard({ stage: "inbox", cim_url: file }), false);
  assert.equal(isNextCimReviewCard({ stage: "pursuing", cim_url: file }), false);
  assert.equal(isNextCimReviewCard({ stage: "closed", cim_url: file }), false);
  assert.equal(isNextCimReviewCard({ stage: "shortlist", cim_url: null }), false);
});

test("nextCimDeck hides a card only after this member's CIM vote", () => {
  const file = "https://drive.google.com/file/d/iron/view";
  const deals = [
    { id: 1, stage: "cim", cim_url: file, cim_verdicts: {} },
    { id: 2, stage: "cim", cim_url: file, cim_verdicts: { tristan: { action: "pass" as const } } },
    { id: 3, stage: "inbox", cim_url: file, cim_verdicts: {} },
    { id: 4, stage: "nda", cim_url: file, cim_verdicts: {} },
    { id: 5, stage: "cim", cim_url: null, cim_verdicts: {} },
  ];
  assert.deepEqual(
    nextCimDeck(deals, "tristan").map((row) => row.id),
    [1, 4, 5],
  );
  assert.deepEqual(
    nextCimDeck(deals, "partner").map((row) => row.id),
    [1, 2, 4, 5],
  );
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

test("partnerNotesOnly keeps Tristan and Jim, drops Simon", () => {
  const notes = [
    { id: 1, member: "tristan", body: "mine" },
    { id: 2, member: "simon", body: "specialist writeup" },
    { id: 3, member: "partner", body: "jim" },
  ];
  assert.deepEqual(
    partnerNotesOnly(notes).map((note) => note.member),
    ["tristan", "partner"],
  );
});
