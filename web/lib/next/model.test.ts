import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NEXT_BOARD_STAGES,
  canonicalizeNextStage,
  coerceNextStage,
  defaultNextAction,
  isAwaitCimAction,
  isNextReviewStage,
  mapNextStage,
  nextActionAfterCimPack,
  nextFollowupKind,
  nextStageLabel,
  resolveNextAction,
  sanitizeNextAction,
  shouldAdvanceToCimOnPack,
} from "./stages.ts";

test("board is exactly Shortlisted, NDA, CIM, Pursuing, Closed", () => {
  assert.deepEqual(
    NEXT_BOARD_STAGES.map((s) => s.id),
    ["shortlist", "nda", "cim", "pursuing", "closed"],
  );
  assert.deepEqual(
    NEXT_BOARD_STAGES.map((s) => s.label),
    ["Shortlisted", "NDA", "CIM", "Pursuing", "Closed"],
  );
});

test("legacy stages map onto the five columns", () => {
  const cases: [unknown, string][] = [
    ["pof", "nda"],
    ["proof of funds", "nda"],
    ["shortlisted", "shortlist"],
    ["shortlist", "shortlist"],
    ["nda_to_sign", "nda"],
    ["nda", "nda"],
    ["nda signed", "nda"],
    ["nda_signed", "nda"],
    ["cim", "cim"],
    ["CIM / data room", "cim"],
    ["data room", "cim"],
    ["awaiting_reply", "pursuing"],
    ["active", "pursuing"],
    ["pursuing", "pursuing"],
    ["dead", "closed"],
    ["pass", "closed"],
    ["passed", "closed"],
    ["closed", "closed"],
    ["inbox", "inbox"],
    ["inbound", "inbox"],
  ];
  for (const [raw, want] of cases) {
    assert.equal(mapNextStage(raw), want, String(raw));
    assert.equal(canonicalizeNextStage(raw), want, String(raw));
    assert.equal(coerceNextStage(raw), want, String(raw));
  }
});

test("unknown stage strings coerce to inbox instead of throwing", () => {
  assert.equal(mapNextStage("not-a-stage"), null);
  assert.equal(canonicalizeNextStage("hold"), null);
  assert.equal(coerceNextStage("not-a-stage"), "inbox");
  assert.equal(coerceNextStage(null), "inbox");
  assert.equal(nextStageLabel("pof"), "NDA");
  assert.equal(nextStageLabel("dead"), "Closed");
  assert.equal(nextStageLabel("awaiting_reply"), "Pursuing");
});

test("next-action copy has no POF", () => {
  assert.equal(defaultNextAction("shortlist"), "Request NDA");
  assert.equal(defaultNextAction("nda"), "Sign the NDA");
  assert.equal(defaultNextAction("pursuing"), "Continue pursuit");
  assert.equal(defaultNextAction("closed"), null);
  assert.equal(sanitizeNextAction("Request NDA or send POF"), "Request NDA");
  assert.equal(sanitizeNextAction("Send proof of funds"), "Request NDA");
  assert.equal(sanitizeNextAction("Continue active review"), "Continue pursuit");
  assert.equal(sanitizeNextAction("Follow up with broker"), "Follow up with broker");
});

test("a stamped CIM pack never shows Await CIM / data room", () => {
  assert.equal(isAwaitCimAction("Await CIM / data room"), true);
  assert.equal(isAwaitCimAction("await CIM"), true);
  assert.equal(isAwaitCimAction("Review CIM against buy box"), false);
  assert.equal(resolveNextAction("nda", "Await CIM / data room", "https://drive.google.com/file/d/x/view"), "Review CIM against buy box");
  assert.equal(resolveNextAction("nda", "Await CIM / data room", null), "Await CIM / data room");
  assert.equal(resolveNextAction("pursuing", "Await CIM / data room", "https://drive.google.com/file/d/x/view"), "Continue pursuit");
  assert.equal(resolveNextAction("closed", "Await CIM / data room", "https://drive.google.com/file/d/x/view"), null);
  assert.equal(nextActionAfterCimPack("cim", "Await CIM / data room"), "Review CIM against buy box");
  assert.equal(nextActionAfterCimPack("cim", "Sign the NDA"), "Review CIM against buy box");
  assert.equal(nextActionAfterCimPack("cim", "Follow up with broker"), "Follow up with broker");
});

test("stamping a pack advances live deals to CIM; closed and pursuing stay put", () => {
  assert.equal(shouldAdvanceToCimOnPack("inbox"), true);
  assert.equal(shouldAdvanceToCimOnPack("shortlist"), true);
  assert.equal(shouldAdvanceToCimOnPack("nda"), true);
  assert.equal(shouldAdvanceToCimOnPack("cim"), true);
  assert.equal(shouldAdvanceToCimOnPack("pursuing"), false);
  assert.equal(shouldAdvanceToCimOnPack("closed"), false);
});

test("follow-ups arm on NDA, CIM, and Pursuing only", () => {
  assert.equal(nextFollowupKind("nda"), "nda");
  assert.equal(nextFollowupKind("cim"), "cim");
  assert.equal(nextFollowupKind("pursuing"), "broker_reply");
  assert.equal(nextFollowupKind("shortlist"), null);
  assert.equal(nextFollowupKind("closed"), null);
});

test("Review swipe is inbound only — board stages stay off the deck", () => {
  assert.equal(isNextReviewStage("inbox"), true);
  assert.equal(isNextReviewStage("inbound"), true);
  assert.equal(isNextReviewStage("shortlist"), false);
  assert.equal(isNextReviewStage("nda"), false);
  assert.equal(isNextReviewStage("cim"), false);
  assert.equal(isNextReviewStage("pursuing"), false);
  assert.equal(isNextReviewStage("closed"), false);
  assert.equal(isNextReviewStage("dead"), false);
});
