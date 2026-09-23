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
        gmailThreadIds: ["same-thread"],
      },
    ],
  );
  assert.equal(hit, null);
});

test("identical headline alone does not join", () => {
  const hit = findIdentityMatch(
    {
      title: "Oilfield and Agriculture Supply Company in Kansas",
      ebitda: 400_000,
      gmailThreadIds: ["other-thread"],
    },
    [
      {
        id: 240,
        dealNumber: "TLY-240",
        title: "Oilfield and Agriculture Supply Company in Kansas",
        ebitda: 1_250_000,
        gmailThreadIds: ["1a0ac26af41f876c"],
      },
    ],
  );
  assert.equal(hit, null);
});

test("identical headline plus a shared Gmail thread joins", () => {
  const hit = findIdentityMatch(
    {
      title: "Oilfield and Agriculture Supply Company in Kansas",
      ebitda: 400_000,
      gmailThreadIds: ["1a0ac26af41f876c"],
    },
    [
      {
        id: 240,
        dealNumber: "TLY-240",
        title: "Oilfield and Agriculture Supply Company in Kansas",
        ebitda: 1_250_000,
        gmailThreadIds: ["1a0ac26af41f876c"],
      },
    ],
  );
  assert.equal(hit?.reason, "headline");
  assert.equal(hit?.candidate.dealNumber, "TLY-240");
});

test("identical headline plus the same state joins", () => {
  const hit = findIdentityMatch(
    {
      title: "Commercial Landscape Maintenance Company",
      state: "FL",
    },
    [
      {
        id: 473,
        dealNumber: "TLY-473",
        title: "Commercial Landscape Maintenance Company",
        city: "Hollywood",
        state: "FL",
      },
    ],
  );
  assert.equal(hit?.reason, "headline");
});

test("identical headline plus the same broker joins", () => {
  const hit = findIdentityMatch(
    {
      title: "Commercial Landscape Maintenance Company",
      brokerFirm: "Search Genius",
    },
    [
      {
        id: 473,
        dealNumber: "TLY-473",
        title: "Commercial Landscape Maintenance Company",
        brokerFirm: "Search Genius",
        state: "TX",
      },
    ],
  );
  assert.equal(hit?.reason, "headline");
});


test("posted sourceDealId joins even when URL is missing or percent-encoded", () => {
  const owner = {
    id: 10,
    dealNumber: "TLY-410",
    sourceDealId: "axial:88de30e9a6c7452b8213fdc741a0fefc",
    title: "Old PCB name",
    source: "axial.net",
    nickname: "Axial",
  };
  const titleTwin = {
    id: 11,
    dealNumber: "TLY-411",
    sourceDealId: null as string | null,
    title: "High-Frequency PCB Manufacturer With Diversified Customers",
    source: "axial.net",
    nickname: "Axial",
  };

  const byPosted = findIdentityMatch(
    {
      title: titleTwin.title,
      source: "axial.net",
      nickname: "Axial",
      sourceDealId: "axial:88de30e9a6c7452b8213fdc741a0fefc",
    },
    [titleTwin, owner],
  );
  assert.equal(byPosted?.reason, "source_id");
  assert.equal(byPosted?.candidate.dealNumber, "TLY-410");

  const encoded =
    "https://network.axial.net/received-deals/new%3Bid=88de30e9a6c7452b8213fdc741a0fefc%3Btab=details";
  const byEncodedUrl = findIdentityMatch(
    {
      title: titleTwin.title,
      source: "axial.net",
      url: encoded,
    },
    [titleTwin, owner],
  );
  assert.equal(byEncodedUrl?.reason, "source_id");
  assert.equal(byEncodedUrl?.candidate.dealNumber, "TLY-410");
});

test("URL or nickname hex still hits a null-column twin ahead of the column owner", () => {
  const axialId = "axial:88de30e9a6c7452b8213fdc741a0fefc";
  const title = "High-Frequency PCB Manufacturer With Diversified Customers";
  const url =
    "https://network.axial.net/received-deals/new;id=88de30e9a6c7452b8213fdc741a0fefc;tab=details;action=pursue";
  const keeper = {
    id: 2,
    dealNumber: "TLY-259",
    sourceDealId: axialId,
    title: "PCB manufacturer — keeper",
    source: "axial.net",
    nickname: "Axial",
  };
  const byUrl = findIdentityMatch(
    { title, url, source: "axial.net", sourceDealId: axialId },
    [{ id: 1, dealNumber: "TLY-286", sourceDealId: null, title, url, source: "axial.net" }, keeper],
  );
  assert.equal(byUrl?.reason, "listing_url");
  assert.equal(byUrl?.candidate.dealNumber, "TLY-286");

  const byNick = findIdentityMatch(
    { title, source: "axial.net", sourceDealId: axialId },
    [
      {
        id: 1,
        dealNumber: "TLY-286",
        sourceDealId: null,
        title,
        source: "axial.net",
        nickname: "88de30e9a6c7452b8213fdc741a0fefc",
      },
      keeper,
    ],
  );
  assert.equal(byNick?.reason, "source_id");
  assert.equal(byNick?.candidate.dealNumber, "TLY-286");
});
