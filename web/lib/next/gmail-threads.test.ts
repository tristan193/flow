import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { query } from "../db.ts";
import { applyAuthorizedGmailThreads, nextGmailThreadIds } from "./gmail-threads.ts";

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

test("replace overwrites thread ids; append and prepend keep order", () => {
  assert.deepEqual(nextGmailThreadIds(["digest", "old"], ["correct"], "replace"), ["correct"]);
  assert.deepEqual(nextGmailThreadIds(["digest"], [], "replace"), []);
  assert.deepEqual(
    nextGmailThreadIds(["digest"], ["correct", " correct ", "CORRECT", ""], "replace"),
    ["correct"],
  );
  assert.deepEqual(
    nextGmailThreadIds(["digest", "old"], ["fresh", "old"], "append"),
    ["digest", "old", "fresh"],
  );
  assert.deepEqual(
    nextGmailThreadIds(["digest", "old"], ["fresh"], "prepend"),
    ["fresh", "digest", "old"],
  );
});

test("token replace overwrites gmail_thread_ids and leaves source_deal_id alone", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = "test-dirk-gmail-threads";
  try {
    await query(
      `INSERT INTO deals_next (deal_number, title, stage, source_deal_id, gmail_thread_ids)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      ["TLY-096", "Multi listing digest", "shortlist", "bbs:q123", JSON.stringify(["digest-thread", "other"])],
    );

    const noToken = await applyAuthorizedGmailThreads({
      authorization: null,
      dealNumber: "TLY-096",
      mode: "replace",
      gmailThreadIds: ["1a086a480b0fbc7e"],
    });
    assert.equal(noToken.ok, false);
    if (!noToken.ok) assert.equal(noToken.status, 401);

    const wrong = await applyAuthorizedGmailThreads({
      authorization: "Bearer not-the-token",
      dealNumber: "TLY-096",
      mode: "replace",
      gmailThreadIds: ["1a086a480b0fbc7e"],
    });
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.equal(wrong.status, 401);

    const missing = await applyAuthorizedGmailThreads({
      authorization: "Bearer test-dirk-gmail-threads",
      dealNumber: "TLY-999",
      mode: "replace",
      gmailThreadIds: ["1a086a480b0fbc7e"],
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 404);

    const badMode = await applyAuthorizedGmailThreads({
      authorization: "Bearer test-dirk-gmail-threads",
      dealNumber: "TLY-096",
      mode: "merge",
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
      dealNumber: "BBS-96",
      mode: "replace",
      gmailThreadIds: ["1a086a480b0fbc7e"],
    });
    assert.equal(badNumber.ok, false);
    if (!badNumber.ok) assert.equal(badNumber.status, 400);

    const replaced = await applyAuthorizedGmailThreads({
      authorization: "Bearer test-dirk-gmail-threads",
      dealNumber: "tly-096",
      mode: "replace",
      gmailThreadIds: ["1a086a480b0fbc7e", "1a086a480b0fbc7e", "  "],
    });
    assert.equal(replaced.ok, true);
    if (replaced.ok) {
      assert.equal(replaced.dealNumber, "TLY-096");
      assert.deepEqual(replaced.gmailThreadIds, ["1a086a480b0fbc7e"]);
    }

    const row = await query<{
      title: string;
      source_deal_id: string;
      gmail_thread_ids: unknown;
    }>("SELECT title, source_deal_id, gmail_thread_ids FROM deals_next WHERE deal_number = 'TLY-096'");
    assert.equal(row[0].title, "Multi listing digest");
    assert.equal(row[0].source_deal_id, "bbs:q123");
    assert.deepEqual(row[0].gmail_thread_ids, ["1a086a480b0fbc7e"]);

    const cleared = await applyAuthorizedGmailThreads({
      authorization: "Bearer test-dirk-gmail-threads",
      dealNumber: "TLY-096",
      mode: "replace",
      gmailThreadIds: [],
    });
    assert.equal(cleared.ok, true);
    if (cleared.ok) assert.deepEqual(cleared.gmailThreadIds, []);

    const ordered = await applyAuthorizedGmailThreads({
      authorization: "Bearer test-dirk-gmail-threads",
      dealNumber: "TLY-096",
      mode: "replace",
      gmailThreadIds: ["second", "first", "second"],
    });
    assert.equal(ordered.ok, true);
    if (ordered.ok) assert.deepEqual(ordered.gmailThreadIds, ["second", "first"]);

    const logs = await query<{ channel: string; patch: { gmail_thread_ids?: { new?: unknown } } }>(
      "SELECT channel, patch FROM deal_log WHERE deal_number = 'TLY-096' AND kind = 'update' ORDER BY id",
    );
    assert.ok(logs.length >= 1);
    assert.equal(logs[0].channel, "api:next/gmail-threads");
    assert.deepEqual(logs[0].patch.gmail_thread_ids?.new, ["1a086a480b0fbc7e"]);
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("gmail-threads route is token-only and allowlisted", () => {
  const route = readFileSync(path.join(process.cwd(), "app/api/next/gmail-threads/route.ts"), "utf8");
  const middleware = readFileSync(path.join(process.cwd(), "middleware.ts"), "utf8");
  assert.match(route, /FLOW_IMPORT_TOKEN/);
  assert.match(route, /applyAuthorizedGmailThreads/);
  assert.match(route, /gmailThreadIds: result\.gmailThreadIds/);
  assert.match(middleware, /\/api\/next\/gmail-threads/);
});
