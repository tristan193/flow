import { test } from "node:test";
import assert from "node:assert/strict";

import { nextInboxDeck } from "./model.ts";
import {
  formatDuplicateOf,
  isAttachOnlyIngest,
  isNextRemintCard,
  parseIngestDisposition,
} from "./remint.ts";

test("parseIngestDisposition accepts house names and a few aliases", () => {
  assert.equal(parseIngestDisposition("new"), "new");
  assert.equal(parseIngestDisposition("attached"), "attached");
  assert.equal(parseIngestDisposition("remint"), "remint");
  assert.equal(parseIngestDisposition("ATTACH"), "attached");
  assert.equal(parseIngestDisposition("attach"), "attached");
  assert.equal(parseIngestDisposition("dupe"), "remint");
  assert.equal(parseIngestDisposition("duplicate"), "remint");
  assert.equal(parseIngestDisposition(""), null);
  assert.equal(parseIngestDisposition("maybe"), null);
});

test("formatDuplicateOf normalizes TLY padding", () => {
  assert.equal(formatDuplicateOf("TLY-132"), "TLY-132");
  assert.equal(formatDuplicateOf("tly-12"), "TLY-012");
  assert.equal(formatDuplicateOf("not-a-deal"), null);
  assert.equal(formatDuplicateOf(null), null);
});

test("isNextRemintCard is structured — blurb is irrelevant", () => {
  assert.equal(isNextRemintCard({ duplicate_of: "TLY-132", ingest_disposition: null }), true);
  assert.equal(isNextRemintCard({ duplicate_of: null, ingest_disposition: "remint" }), true);
  assert.equal(isNextRemintCard({ duplicate_of: null, ingest_disposition: "attached" }), true);
  assert.equal(isNextRemintCard({ duplicate_of: null, ingest_disposition: "new" }), false);
  assert.equal(isNextRemintCard({ duplicate_of: null, ingest_disposition: null }), false);
});

test("isAttachOnlyIngest reads camelCase ingest payload", () => {
  assert.equal(isAttachOnlyIngest({ duplicateOf: "TLY-132" }), true);
  assert.equal(isAttachOnlyIngest({ ingestDisposition: "attached" }), true);
  assert.equal(isAttachOnlyIngest({ ingestDisposition: "new" }), false);
  assert.equal(isAttachOnlyIngest({}), false);
});

test("nextInboxDeck drops remint/attached cards even when still inbox", () => {
  const deals = [
    { id: 1, stage: "inbox", verdicts: {}, duplicate_of: null, ingest_disposition: null },
    { id: 2, stage: "inbox", verdicts: {}, duplicate_of: "TLY-132", ingest_disposition: "remint" },
    { id: 3, stage: "inbox", verdicts: {}, duplicate_of: null, ingest_disposition: "attached" },
  ];
  assert.deepEqual(
    nextInboxDeck(deals, "tristan").map((row) => row.id),
    [1],
  );
});
