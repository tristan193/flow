import { test, before } from "node:test";
import assert from "node:assert/strict";

import { query } from "../db.ts";
import { isDirkForcedGmailHref } from "../gmail-thread.ts";
import { gmailThreadHrefs } from "./deals.ts";
import { listDirkFollowups, listDirkInbound } from "./dirk.ts";
import { gmailAllHref } from "./identity.ts";

async function resetNext() {
  await query(`
    TRUNCATE TABLE
      verdicts_next,
      cim_verdicts_next,
      stage_events_next,
      notes_next,
      deal_files_next,
      next_followups,
      next_import_runs,
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
