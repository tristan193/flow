import { test } from "node:test";
import assert from "node:assert/strict";

import { harvestDealToNext, harvestFirstSeenIsNew } from "./import.ts";

test("harvest first_seen within 4 days is new; older catalog is not", () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");
  assert.equal(harvestFirstSeenIsNew("2026-09-18T11:00:00.000Z", now), true);
  assert.equal(harvestFirstSeenIsNew("2026-09-14T12:00:00.000Z", now), true);
  assert.equal(harvestFirstSeenIsNew("2026-09-14T11:59:59.000Z", now), false);
  assert.equal(harvestFirstSeenIsNew("2020-01-01T00:00:00.000Z", now), false);
  assert.equal(harvestFirstSeenIsNew(null, now), true);
  assert.equal(harvestFirstSeenIsNew("", now), true);
});

test("harvestDealToNext sets skipIfNew on old first_seen and passes remint fields", () => {
  const old = harvestDealToNext({
    extId: "bbs:1",
    title: "Old shop",
    firstSeen: "2020-01-01T00:00:00.000Z",
    duplicateOf: "TLY-010",
    ingestDisposition: "attached",
  });
  assert.equal(old.skipIfNew, true);
  assert.equal(old.duplicateOf, "TLY-010");
  assert.equal(old.ingestDisposition, "attached");

  const fresh = harvestDealToNext({
    extId: "bbs:2",
    title: "New shop",
    firstSeen: new Date().toISOString(),
  });
  assert.equal(fresh.skipIfNew, false);
});

test("harvestDealToNext forwards gmailThreadIds for /api/import merge", () => {
  const mapped = harvestDealToNext({
    extId: "bbs:3",
    title: "Linked shop",
    url: "https://www.bizbuysell.com/business-opportunity/hvac/2214412",
    firstSeen: new Date().toISOString(),
    gmailThreadIds: ["18f0threadAAA"],
  });
  assert.deepEqual(mapped.gmailThreadIds, ["18f0threadAAA"]);
  assert.equal(mapped.url, "https://www.bizbuysell.com/business-opportunity/hvac/2214412");
  assert.equal(mapped.skipIfNew, false);

  const empty = harvestDealToNext({
    extId: "bbs:4",
    title: "No threads yet",
    firstSeen: new Date().toISOString(),
  });
  assert.equal(empty.gmailThreadIds, undefined);
});
