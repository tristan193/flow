import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dealIdLine,
  dealIdLines,
  listingIdLabel,
  looksLikeListingId,
  sourceDisplayName,
} from "./display.ts";

test("listing-id detection: hex, q=, Transworld, digits — not source names", () => {
  assert.equal(looksLikeListingId("deadbeefcafebabe"), true);
  assert.equal(looksLikeListingId("q=2214412"), true);
  assert.equal(looksLikeListingId("2214412"), true);
  assert.equal(looksLikeListingId("1234-567890"), true);
  assert.equal(looksLikeListingId("axial:deadbeefcafebabe"), true);
  assert.equal(looksLikeListingId("bbs:2214412"), true);
  assert.equal(looksLikeListingId("Axial"), false);
  assert.equal(looksLikeListingId("BizBuySell"), false);
  assert.equal(looksLikeListingId("Rejigg"), false);
});

test("BBS listing id formats as q=", () => {
  assert.equal(
    listingIdLabel({
      source_ids: [{ kind: "bbs", value: "2214412", canonical: "bbs:2214412" }],
    }),
    "q=2214412",
  );
  assert.equal(
    listingIdLabel({
      url: "https://www.bizbuysell.com/business-opportunity/Profile/?q=1999001",
    }),
    "q=1999001",
  );
});

test("Axial hex and Transworld stay as listing ids, not pill text", () => {
  assert.equal(
    listingIdLabel({
      source_deal_id: "axial:deadbeefcafebabe",
      source_ids: [{ kind: "axial", value: "deadbeefcafebabe", canonical: "axial:deadbeefcafebabe" }],
    }),
    "deadbeefcafebabe",
  );
  assert.equal(
    listingIdLabel({
      source_ids: [{ kind: "tw", value: "1234-567890", canonical: "tw:1234-567890" }],
    }),
    "1234-567890",
  );
});

test("ID stack is TLY then listing id on separate lines", () => {
  assert.deepEqual(
    dealIdLines({
      deal_number: "TLY-014",
      source_ids: [{ kind: "axial", value: "4e6c5aa5ce4284858c76facdeb6074", canonical: "axial:4e6c5aa5ce4284858c76facdeb6074" }],
    }),
    ["TLY-014", "4e6c5aa5ce4284858c76facdeb6074"],
  );
  assert.equal(
    dealIdLine({
      deal_number: "TLY-034",
      source_ids: [{ kind: "bbs", value: "2214412", canonical: "bbs:2214412" }],
    }),
    "TLY-034 · q=2214412",
  );
  assert.deepEqual(dealIdLines({ deal_number: "TLY-002" }), ["TLY-002"]);
});

test("nickname-as-id (prod Axial hex / WC number) goes on the ID line, not the pill", () => {
  assert.deepEqual(
    dealIdLines({
      deal_number: "TLY-035",
      nickname: "fe962202156a4cf0aacb395f1b891096",
      source: "axial.net",
    }),
    ["TLY-035", "fe962202156a4cf0aacb395f1b891096"],
  );
  assert.equal(
    sourceDisplayName({
      nickname: "fe962202156a4cf0aacb395f1b891096",
      source: "axial.net",
    }),
    "Axial",
  );
  assert.deepEqual(
    dealIdLines({
      deal_number: "TLY-034",
      nickname: "119402",
      source: "websiteclosers.com",
    }),
    ["TLY-034", "119402"],
  );
  assert.equal(
    sourceDisplayName({
      nickname: "119402",
      source: "websiteclosers.com",
    }),
    "WebsiteClosers",
  );
});

test("source pill uses human names, never hex or q=", () => {
  assert.equal(sourceDisplayName({ nickname: "Axial", source: "axial.net" }), "Axial");
  assert.equal(sourceDisplayName({ nickname: "deadbeefcafebabe", source: "axial.net" }), "Axial");
  assert.equal(
    sourceDisplayName({ nickname: "q=2214412", source: "bizbuysell.com" }),
    "BizBuySell",
  );
  assert.equal(
    sourceDisplayName({ nickname: "2214412", sub_source: "bizalert@bizbuysell.com" }),
    "BizBuySell",
  );
  assert.equal(sourceDisplayName({ source: "rejigg.com", nickname: null }), "Rejigg");
  assert.equal(
    sourceDisplayName({
      nickname: "a1b2c3d4e5f67890",
      url: "https://network.axial.net/app/opportunity/a1b2c3d4e5f67890?action=pursue",
    }),
    "Axial",
  );
  assert.equal(
    sourceDisplayName({
      nickname: "deadbeefcafebabe",
      source_ids: [{ kind: "axial", value: "deadbeefcafebabe", canonical: "axial:deadbeefcafebabe" }],
    }),
    "Axial",
  );
});
