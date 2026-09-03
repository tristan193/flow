import { test, before } from "node:test";
import assert from "node:assert/strict";

import { query } from "./db.ts";
import { getDeal } from "./deals.ts";
import { isDirkForcedGmailHref } from "./gmail-thread.ts";

before(async () => {
  await query("SELECT 1");
});

test("classic deals rewrite stored u/0 Gmail URLs on read", async () => {
  const rows = await query<{ id: number }>(
    `INSERT INTO deals (ext_id, title, gmail_thread_url)
     VALUES ($1, $2, $3)
     RETURNING id`,
    ["gmail-authuser-test", "Stored u/0 thread", "https://mail.google.com/mail/u/0/#all/18f0abc"],
  );
  const deal = await getDeal(rows[0].id);
  assert.ok(deal);
  assert.equal(
    deal.gmail_thread_url,
    "https://mail.google.com/mail/?authuser=dirk%40tullyinvesting.com#all/18f0abc",
  );
  assert.equal(isDirkForcedGmailHref(deal.gmail_thread_url), true);
  await query("DELETE FROM deals WHERE ext_id = $1", ["gmail-authuser-test"]);
});
