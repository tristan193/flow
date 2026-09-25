import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { query } from "../db.ts";
import { applyAuthorizedGmailThreads, orderGmailThreadIds } from "./gmail-threads-auth.ts";

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

test("orderGmailThreadIds replaces, prepends, and appends without dropping order", () => {
  assert.deepEqual(orderGmailThreadIds(["digest", "real"], ["real"], "replace"), ["real"]);
  assert.deepEqual(orderGmailThreadIds(["digest", "real"], [], "replace"), []);
  assert.deepEqual(orderGmailThreadIds(["keep"], ["b", "a", "b", "A"], "replace"), ["b", "a"]);
  assert.deepEqual(orderGmailThreadIds(["old", "keep"], ["new", "old"], "prepend"), ["new", "old", "keep"]);
  assert.deepEqual(orderGmailThreadIds(["aaa"], ["bbb", "aaa"], "append"), ["aaa", "bbb"]);
});

test("replace sets gmail_thread_ids exactly and leaves source_deal_id alone", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = "test-dirk-gmail-threads";
  try {
    await query(
      `INSERT INTO deals_next (deal_number, title, stage, source_deal_id, gmail_thread_ids)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      ["TLY-096", "Multi listing", "shortlist", "bbs:2214412", JSON.stringify(["wrongdigest", "1a086a480b0fbc7e"])],
    );

    const noToken = await applyAuthorizedGmailThreads({
      authorization: null,
      dealNumber: "TLY-096",
      mode: "replace",
      gmailThreadIds: ["1a086a480b0fbc7e"],
    });
    assert.equal(noToken.ok, false);
    if (!noToken.ok) assert.equal(noToken.status, 401);

    const badMode = await applyAuthorizedGmailThreads({
      authorization: "Bearer test-dirk-gmail-threads",
      dealNumber: "TLY-096",
      mode: "overwrite",
      gmailThreadIds: ["1a086a480b0fbc7e"],
    });
    assert.equal(badMode.ok, false);
    if (!badMode.ok) assert.equal(badMode.status, 400);

    const badIds = await applyAuthorizedGmailThreads({
      authorization: "Bearer test-dirk-gmail-threads",
      dealNumber: "TLY-096",
      mode: "replace",
      gmailThreadIds: "1a086a480b0fbc7e",
    });
    assert.equal(badIds.ok, false);
    if (!badIds.ok) assert.equal(badIds.status, 400);

    const badNumber = await applyAuthorizedGmailThreads({
      authorization: "Bearer test-dirk-gmail-threads",
      dealNumber: "not-a-deal",
      mode: "replace",
      gmailThreadIds: ["1a086a480b0fbc7e"],
    });
    assert.equal(badNumber.ok, false);
    if (!badNumber.ok) assert.equal(badNumber.status, 400);

    const missing = await applyAuthorizedGmailThreads({
      authorization: "Bearer test-dirk-gmail-threads",
      dealNumber: "TLY-999",
      mode: "replace",
      gmailThreadIds: ["1a086a480b0fbc7e"],
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 404);

    const replaced = await applyAuthorizedGmailThreads({
      authorization: "Bearer test-dirk-gmail-threads",
      dealNumber: "tly-096",
      mode: "replace",
      gmailThreadIds: [
        "https://mail.google.com/mail/?authuser=dirk%40tullyinvesting.com#all/1a086a480b0fbc7e",
        "1a086a480b0fbc7e",
      ],
    });
    assert.equal(replaced.ok, true);
    if (replaced.ok) {
      assert.equal(replaced.dealNumber, "TLY-096");
      assert.deepEqual(replaced.gmailThreadIds, ["1a086a480b0fbc7e"]);
    }

    const row = await query<{
      source_deal_id: string;
      stage: string;
      title: string;
      gmail_thread_ids: unknown;
    }>("SELECT source_deal_id, stage, title, gmail_thread_ids FROM deals_next WHERE deal_number = 'TLY-096'");
    assert.equal(row[0].source_deal_id, "bbs:2214412");
    assert.equal(row[0].stage, "shortlist");
    assert.equal(row[0].title, "Multi listing");
    assert.deepEqual(row[0].gmail_thread_ids, ["1a086a480b0fbc7e"]);

    const cleared = await applyAuthorizedGmailThreads({
      authorization: "Bearer test-dirk-gmail-threads",
      dealNumber: "TLY-096",
      mode: "replace",
      gmailThreadIds: [],
    });
    assert.equal(cleared.ok, true);
    if (cleared.ok) assert.deepEqual(cleared.gmailThreadIds, []);

    const prepended = await applyAuthorizedGmailThreads({
      authorization: "Bearer test-dirk-gmail-threads",
      dealNumber: "TLY-096",
      mode: "prepend",
      gmailThreadIds: ["aaa"],
    });
    assert.equal(prepended.ok, true);
    if (prepended.ok) assert.deepEqual(prepended.gmailThreadIds, ["aaa"]);

    const appended = await applyAuthorizedGmailThreads({
      authorization: "Bearer test-dirk-gmail-threads",
      dealNumber: "TLY-096",
      mode: "append",
      gmailThreadIds: ["bbb", "aaa"],
    });
    assert.equal(appended.ok, true);
    if (appended.ok) assert.deepEqual(appended.gmailThreadIds, ["aaa", "bbb"]);
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("gmail-threads route is token-only and allowlisted", () => {
  const route = readFileSync(path.join(process.cwd(), "app/api/next/gmail-threads/route.ts"), "utf8");
  const auth = readFileSync(path.join(process.cwd(), "lib/next/gmail-threads-auth.ts"), "utf8");
  const middleware = readFileSync(path.join(process.cwd(), "middleware.ts"), "utf8");
  assert.match(route, /FLOW_IMPORT_TOKEN/);
  assert.match(route, /applyAuthorizedGmailThreads/);
  assert.doesNotMatch(route, /currentMember/);
  assert.match(auth, /resolveMachineActor/);
  assert.match(auth, /gmail_thread_ids/);
  assert.doesNotMatch(auth, /source_deal_id/);
  assert.match(middleware, /\/api\/next\/gmail-threads/);
});
