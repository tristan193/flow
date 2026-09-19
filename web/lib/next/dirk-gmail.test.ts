import { test, before } from "node:test";
import assert from "node:assert/strict";

import { query } from "../db.ts";
import { isDirkForcedGmailHref } from "../gmail-thread.ts";
import { gmailThreadHrefs } from "./deals.ts";
import { listDirkFollowups, listDirkInbound, listDirkVerdicts } from "./dirk.ts";
import { gmailAllHref } from "./identity.ts";

async function resetNext() {
  await query(`
    TRUNCATE TABLE
      deal_log,
      deals_next,
      next_deal_counters
    RESTART IDENTITY CASCADE
  `);
  await query(`INSERT INTO next_deal_counters (key, next_n) VALUES ('tly', 1)`);
}

before(async () => {
  await query("SELECT 1");
});

test("Dirk API gmailLinks and Next hrefs force dirk@ on stored thread ids", async () => {
  await resetNext();
  await query(
    `INSERT INTO deals_next (deal_number, title, stage, gmail_thread_ids)
     VALUES ($1, $2, $3, $4::jsonb)`,
    ["TLY-092", "Project Cactus", "inbox", JSON.stringify(["18f0abc"])],
  );
  await query(
    `INSERT INTO deals_next (deal_number, title, stage, gmail_thread_ids)
     VALUES ($1, $2, $3, $4::jsonb)`,
    ["TLY-031", "Iron Bull", "cim", JSON.stringify(["https://mail.google.com/mail/u/0/#all/deadbeef"])],
  );

  const inbound = await listDirkInbound();
  const cactus = inbound.find((row) => row.dealNumber === "TLY-092");
  assert.ok(cactus);
  assert.equal(cactus.gmailLinks.length, 1);
  assert.equal(isDirkForcedGmailHref(cactus.gmailLinks[0]), true);
  assert.equal(
    cactus.gmailLinks[0],
    "https://mail.google.com/mail/?authuser=dirk%40tullyinvesting.com#all/18f0abc",
  );
  assert.doesNotMatch(cactus.gmailLinks[0], /\/mail\/u\/\d+/);

  const followups = await listDirkFollowups();
  const iron = followups.find((row) => row.dealNumber === "TLY-031");
  assert.ok(iron);
  assert.equal(iron.gmailLinks.length, 1);
  assert.equal(isDirkForcedGmailHref(iron.gmailLinks[0]), true);
  assert.match(iron.gmailLinks[0], /#all\/deadbeef$/);
  assert.doesNotMatch(iron.gmailLinks[0], /\/mail\/u\/\d+/);

  assert.deepEqual(gmailThreadHrefs(["18f0abc"]), [gmailAllHref("18f0abc")]);
  assert.equal(isDirkForcedGmailHref(gmailAllHref("18f0abc")), true);
});

test("listDirkFollowups keeps live SL/NDA/CIM/Pursuing when closed watches overflow LIMIT 80", async () => {
  await resetNext();

  const closedWatch = JSON.stringify([
    { kind: "cim", status: "open", armed_by: "dirk", armed_at: "2026-01-01T00:00:00.000Z" },
  ]);
  const closedValues: string[] = [];
  const closedParams: unknown[] = [];
  for (let i = 0; i < 90; i += 1) {
    const n = String(i + 1).padStart(3, "0");
    const base = i * 4;
    closedValues.push(
      `($${base + 1}, $${base + 2}, 'closed', $${base + 3}::jsonb, $${base + 4}::jsonb)`,
    );
    closedParams.push(`TLY-C${n}`, `Closed ${n}`, closedWatch, JSON.stringify([`closed-thread-${n}`]));
  }
  await query(
    `INSERT INTO deals_next (deal_number, title, stage, watches, gmail_thread_ids)
     VALUES ${closedValues.join(",")}`,
    closedParams,
  );

  const live = [
    { num: "TLY-201", title: "Live Shortlist", stage: "shortlist", thread: "sl-thread" },
    { num: "TLY-202", title: "Live NDA", stage: "nda", thread: "nda-thread" },
    { num: "TLY-203", title: "Live CIM", stage: "cim", thread: "cim-thread" },
    { num: "TLY-204", title: "Live Pursuing", stage: "pursuing", thread: "pursue-thread" },
  ];
  for (const deal of live) {
    await query(
      `INSERT INTO deals_next (deal_number, title, stage, gmail_thread_ids)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [deal.num, deal.title, deal.stage, JSON.stringify([deal.thread])],
    );
  }

  const followups = await listDirkFollowups(80);
  const closedFollowups = followups.filter((row) => row.stage === "Closed");
  assert.equal(closedFollowups.length, 0, "closed watches must not appear on the punch list");

  for (const deal of live) {
    const row = followups.find((item) => item.dealNumber === deal.num);
    assert.ok(row, `${deal.num} must stay on the punch list`);
    assert.equal(row.gmailLinks.length, 1);
    assert.match(row.gmailLinks[0], new RegExp(`#all/${deal.thread}$`));
    assert.equal(isDirkForcedGmailHref(row.gmailLinks[0]), true);
  }
});

test("listDirkVerdicts includes gmailLinks from gmail_thread_ids", async () => {
  await resetNext();
  await query(
    `INSERT INTO deals_next (
       deal_number, title, stage, gmail_thread_ids,
       tristan_verdict, tristan_verdict_reason, tristan_verdict_at
     ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
    [
      "TLY-310",
      "Shortlisted Foundry",
      "shortlist",
      JSON.stringify(["verdict-thread"]),
      "short",
      "fits buy box",
      new Date("2026-09-19T12:00:00.000Z"),
    ],
  );

  const verdicts = await listDirkVerdicts();
  const found = verdicts.find((row) => row.dealNumber === "TLY-310");
  assert.ok(found);
  assert.equal(found.gmailLinks.length, 1);
  assert.equal(isDirkForcedGmailHref(found.gmailLinks[0]), true);
  assert.match(found.gmailLinks[0], /#all\/verdict-thread$/);
  assert.doesNotMatch(found.gmailLinks[0], /\/mail\/u\/\d+/);
});
