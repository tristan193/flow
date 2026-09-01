import { test } from "node:test";
import assert from "node:assert/strict";

import { findIdentityMatch, isHarvestExtId } from "./identity.ts";

test("harvest ext_id is never a Next join key", () => {
  assert.equal(isHarvestExtId("bizbuysell.bizalert_digest:18abc:2"), true);
  assert.equal(isHarvestExtId("gmail:18abc:0"), true);
  assert.equal(isHarvestExtId("format:gmail_msg:3"), true);
  assert.equal(isHarvestExtId("bbs:2214412"), false);
  assert.equal(isHarvestExtId("TLY-001"), false);
});

test("two Gmail threads do not mint two deals when source id matches", () => {
  const first = {
    id: 1,
    dealNumber: "TLY-001",
    sourceDealId: "bbs:2214412",
    sourceIds: [{ kind: "bbs" as const, value: "2214412", canonical: "bbs:2214412" }],
    title: "Established HVAC",
    state: "TX",
  };
  const hit = findIdentityMatch(
    {
      title: "Follow-up CIM — HVAC",
      url: "https://www.bizbuysell.com/Business-Opportunity/hvac/?q=2214412",
      gmailThreadIds: ["thread-TWO"],
    },
    [first],
  );
  assert.equal(hit?.reason, "source_id");
  assert.equal(hit?.candidate.dealNumber, "TLY-001");
});

test("one Gmail thread is not treated as a deal identity", () => {
  const hit = findIdentityMatch(
    {
      title: "Totally different shop",
      brokerFirm: "Some Broker",
      gmailThreadIds: ["same-thread"],
    },
    [
      {
        id: 9,
        dealNumber: "TLY-009",
        title: "Water plant",
        brokerFirm: "Other Firm",
      },
    ],
  );
  assert.equal(hit, null);
});
