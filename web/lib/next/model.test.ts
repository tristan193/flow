import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NEXT_BOARD_STAGES,
  canonicalizeNextStage,
  coerceNextStage,
  defaultNextAction,
  mapNextStage,
  nextFollowupKind,
  nextStageLabel,
  sanitizeNextAction,
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

test("follow-ups arm on NDA, CIM, and Pursuing only", () => {
  assert.equal(nextFollowupKind("nda"), "nda");
  assert.equal(nextFollowupKind("cim"), "cim");
  assert.equal(nextFollowupKind("pursuing"), "broker_reply");
  assert.equal(nextFollowupKind("shortlist"), null);
  assert.equal(nextFollowupKind("closed"), null);
});
