import { test } from "node:test";
import assert from "node:assert/strict";

import {
  axialHexFromNickname,
  buildIdentity,
  computeFingerprint,
  extractSourceIds,
  findIdentityMatch,
  formatDealNumber,
  gmailAllHref,
  identityGroupKeys,
  isHarvestExtId,
  isNonDealMail,
  mergeAliasNames,
  mergeThreadIds,
  parseDealNumber,
  sanitizeSourceDealId,
} from "./identity.ts";
import { canonicalizeNextStage } from "./model.ts";

test("deal numbers", () => {
  assert.equal(formatDealNumber(1), "TLY-001");
  assert.equal(formatDealNumber(42), "TLY-042");
  assert.equal(parseDealNumber("tly-001"), 1);
  assert.equal(parseDealNumber("BBS-99"), null);
});

test("Axial hex from Pursue HTML, never from subject", () => {
  const html = `
    <a href="https://network.axial.net/app/opportunity/a1b2c3d4e5f67890?action=decline">Pass</a>
    <a href="https://network.axial.net/app/opportunity/a1b2c3d4e5f67890?action=pursue">Pursue</a>
  `;
  const ids = extractSourceIds({
    html,
    subject: "Regional Restoration And Environmental Services Contractor",
  });
  assert.deepEqual(
    ids.map((s) => s.canonical),
    ["axial:a1b2c3d4e5f67890"],
  );
  assert.deepEqual(extractSourceIds({ subject: "a1b2c3d4e5f67890 looks like hex" }), []);
});

test("BizBuySell q=, V-AID, Transworld", () => {
  assert.equal(
    extractSourceIds({
      url: "https://www.bizbuysell.com/business-opportunity/Profile/?q=2214412&utm_source=alert",
    })[0]?.canonical,
    "bbs:2214412",
  );
  assert.equal(
    extractSourceIds({ subject: "New deal V-AID 847291 — HVAC", source: "vaid.com" })[0]
      ?.canonical,
    "vaid:847291",
  );
  assert.equal(
    extractSourceIds({ subject: "Listing 1234-567890 now available" })[0]?.canonical,
    "tw:1234-567890",
  );
});

test("same deal, two threads — join on source id", () => {
  const hit = findIdentityMatch(
    {
      title: "HVAC follow-up financials",
      url: "https://www.bizbuysell.com/Business-Opportunity/hvac/?q=2214412",
      gmailThreadIds: ["threadBBB"],
    },
    [
      {
        id: 1,
        dealNumber: "TLY-001",
        sourceDealId: "bbs:2214412",
        sourceIds: [{ kind: "bbs", value: "2214412", canonical: "bbs:2214412" }],
        title: "Established HVAC & Plumbing",
        state: "TX",
      },
    ],
  );
  assert.equal(hit?.reason, "source_id");
  assert.equal(hit?.candidate.dealNumber, "TLY-001");
});

test("CIM rename keeps aliases via Axial hex", () => {
  const hit = findIdentityMatch(
    {
      title: "Confidential Information Memorandum — Apex Restoration",
      html: '<a href="https://network.axial.net/app/opportunity/deadbeefcafebabe?action=pursue">Pursue</a>',
    },
    [
      {
        id: 2,
        dealNumber: "TLY-014",
        sourceDealId: "axial:deadbeefcafebabe",
        sourceIds: [
          { kind: "axial", value: "deadbeefcafebabe", canonical: "axial:deadbeefcafebabe" },
        ],
        title: "Regional Restoration Teaser Name",
        aliasNames: ["Regional Restoration Teaser Name"],
      },
    ],
  );
  assert.equal(hit?.reason, "source_id");
  const aliases = mergeAliasNames(
    ["Regional Restoration Teaser Name"],
    "Confidential Information Memorandum — Apex Restoration",
    "Regional Restoration Teaser Name",
  );
  assert.ok(aliases.some((a) => /regional restoration/i.test(a)));
  assert.ok(aliases.some((a) => /apex restoration/i.test(a)));
});

test("missing company name still joins on source id", () => {
  const hit = findIdentityMatch(
    { title: "", subject: "V-AID 111222", source: "vaid.com" },
    [
      {
        id: 3,
        dealNumber: "TLY-003",
        sourceDealId: "vaid:111222",
        sourceIds: [{ kind: "vaid", value: "111222", canonical: "vaid:111222" }],
        title: "(untitled listing)",
      },
    ],
  );
  assert.equal(hit?.reason, "source_id");
});

test("never match on broker name alone", () => {
  const hit = findIdentityMatch(
    {
      title: "Unrelated Roofing Outfit",
      brokerFirm: "Benchmark International",
      state: "OK",
      ebitda: 200_000,
    },
    [
      {
        id: 4,
        dealNumber: "TLY-004",
        title: "Water Treatment Platform",
        brokerFirm: "Benchmark International",
        state: "TX",
      },
    ],
  );
  assert.equal(hit, null);
});

test("fingerprint joins when no source id", () => {
  const { fingerprint, complete } = computeFingerprint({
    title: "Filter Media Co",
    brokerFirm: "Transworld",
    ebitda: 410_000,
    state: "TX",
    city: "Austin",
  });
  assert.equal(complete, true);
  const hit = findIdentityMatch(
    {
      title: "Filter Media Company, LLC",
      brokerFirm: "Transworld Business Advisors",
      ebitda: 412_000,
      state: "TX",
      city: "Austin",
    },
    [
      {
        id: 5,
        dealNumber: "TLY-005",
        fingerprint,
        title: "Filter Media Co",
        brokerFirm: "Transworld",
        state: "TX",
        city: "Austin",
      },
    ],
  );
  assert.equal(hit?.reason, "fingerprint");
});

test("Action Summary is not a deal; threads accumulate", () => {
  assert.equal(
    isNonDealMail({
      subject: "Action Summary for Tristan",
      sender: "notifications@axial.net",
      formatId: "axial.action_summary",
    }),
    true,
  );
  assert.deepEqual(mergeThreadIds(["aaa"], ["bbb", "aaa"]), ["aaa", "bbb"]);
  assert.equal(gmailAllHref("18f0abc"), "https://mail.google.com/mail/u/0/#all/18f0abc");
  assert.equal(buildIdentity({ title: "X" }).dealNumber, null);
  assert.equal(isHarvestExtId("axial.teaser:18abc:0"), true);
  assert.equal(isHarvestExtId("format:gmail_msg:2"), true);
  assert.equal(isHarvestExtId("bbs:2214412"), false);
});

test("harvest ext_id is dropped from source ids and never matches", () => {
  assert.equal(sanitizeSourceDealId("axial.teaser:18abc:0"), null);
  assert.equal(sanitizeSourceDealId("axial:deadbeefcafebabe"), "axial:deadbeefcafebabe");
  const ident = buildIdentity({
    title: "HVAC",
    sourceDealId: "axial.teaser:18abc:0",
    sourceIds: [
      { kind: "axial", value: "teaser:18abc:0", canonical: "axial.teaser:18abc:0" },
    ],
  });
  assert.equal(ident.sourceDealId, null);
  assert.equal(ident.sourceIds.length, 0);

  const hit = findIdentityMatch(
    { title: "HVAC follow-up", extId: "axial.teaser:18abc:0" } as never,
    [
      {
        id: 1,
        dealNumber: "TLY-001",
        sourceDealId: "axial.teaser:18abc:0",
        title: "HVAC",
      },
    ],
  );
  assert.equal(hit, null);
});

test("Dirk stage aliases map onto canonical Next stages", () => {
  assert.equal(canonicalizeNextStage("dead"), "dead");
  assert.equal(canonicalizeNextStage("closed"), "dead");
  assert.equal(canonicalizeNextStage("Pass"), "dead");
  assert.equal(canonicalizeNextStage("passed"), "dead");
  assert.equal(canonicalizeNextStage("pursuing"), "awaiting_reply");
  assert.equal(canonicalizeNextStage("nda_signed"), "nda");
  assert.equal(canonicalizeNextStage("cim"), "cim");
  assert.equal(canonicalizeNextStage("hold"), null);
});

test("Axial hex nickname groups with source id", () => {
  assert.equal(axialHexFromNickname("Axial"), null);
  assert.equal(axialHexFromNickname("deadbeefcafebabe"), "deadbeefcafebabe");
  const fromNick = extractSourceIds({ title: "Auto wash", nickname: "deadbeefcafebabe" });
  assert.deepEqual(
    fromNick.map((s) => s.canonical),
    ["axial:deadbeefcafebabe"],
  );
  const keys = identityGroupKeys({
    nickname: "deadbeefcafebabe",
    sourceIds: [{ kind: "axial", value: "deadbeefcafebabe", canonical: "axial:deadbeefcafebabe" }],
  });
  assert.ok(keys.includes("axial:deadbeefcafebabe"));
});
