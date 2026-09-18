import { test } from "node:test";
import assert from "node:assert/strict";

import { decideMatch, extractListingIds, verbatimTitleMatch } from "./crm-pursuit.ts";

test("listing id in URL is a hard match onto the dealbook candidate", () => {
  const hit = decideMatch(
    [
      {
        id: 42,
        title: "Midwest HVAC",
        url: "https://www.bizbuysell.com/business-opportunity/midwest-hvac/1234567/?q=1234567",
        ext_id: "bbs:1234567 TLY-014",
      },
    ],
    new Set(),
    {},
    "NDA ready",
    "See https://www.bizbuysell.com/business-opportunity/midwest-hvac/1234567/?q=1234567",
  );
  assert.deepEqual(hit, { kind: "hard", dealId: 42, how: "listing_id:1234567" });
});

test("TLY deal number hint hard-matches ext_id haystack", () => {
  const hit = decideMatch(
    [{ id: 7, title: "Water Works", url: null, ext_id: "axial:abc TLY-092" }],
    new Set(),
    { dealNumber: "TLY-092" },
    "CIM attached",
    "",
  );
  assert.deepEqual(hit, { kind: "hard", dealId: 7, how: "listing_id:TLY-092" });
});

test("verbatim title against an armed deal is a hard match", () => {
  const hit = decideMatch(
    [{ id: 3, title: "Gulf Coast Wastewater Platform", url: null, ext_id: "TLY-003" }],
    new Set([3]),
    {},
    "Acted on Gulf Coast Wastewater Platform",
    "",
  );
  assert.equal(hit?.kind, "hard");
  assert.equal(hit && hit.kind === "hard" ? hit.how : null, "verbatim+armed");
});

test("extractListingIds finds Axial opportunity hex", () => {
  const ids = extractListingIds(
    "https://network.axial.net/app/opportunity/aaaabbbbccccdddd?action=pursue",
  );
  assert.ok(ids.includes("aaaabbbbccccdddd"));
});

test("verbatimTitleMatch requires a real headline, not a short token", () => {
  assert.equal(verbatimTitleMatch("HVAC", "HVAC platform Dallas"), false);
  assert.equal(
    verbatimTitleMatch("Gulf Coast Wastewater Platform", "Gulf Coast Wastewater Platform LLC"),
    true,
  );
});
