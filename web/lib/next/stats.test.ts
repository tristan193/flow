import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { query } from "../db.ts";
import { loadNextDealStats } from "./stats.ts";

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

test("loadNextDealStats counts TLY rows, Austin/TX, and stages without loading deals", async () => {
  await resetNext();
  const rows: Array<[string, string | null, string | null, string | null, string]> = [
    ["TLY-001", "Austin", null, "TX", "inbox"],
    ["TLY-002", "Austin", null, null, "shortlist"],
    ["TLY-003", "Dallas", "Greater Austin", "Texas", "cim"],
    ["TLY-004", "Austin", null, "CA", "pursuing"],
    ["TLY-005", "Houston", null, "TX", "closed"],
    ["TLY-006", null, "austin metro", null, "inbox"],
  ];
  for (const [dealNumber, city, region, state, stage] of rows) {
    await query(
      `INSERT INTO deals_next (deal_number, title, city, region, state, stage)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [dealNumber, dealNumber, city, region, state, stage],
    );
  }

  const stats = await loadNextDealStats();
  assert.equal(stats.totalTly, 6);
  assert.equal(stats.austinTx, 4);
  assert.deepEqual(stats.byStage, {
    inbox: 2,
    shortlist: 1,
    cim: 1,
    pursuing: 1,
    closed: 1,
  });
});

test("stats route is token-only and allowlisted like dirk", () => {
  const route = readFileSync(path.join(process.cwd(), "app/api/next/stats/route.ts"), "utf8");
  const middleware = readFileSync(path.join(process.cwd(), "middleware.ts"), "utf8");
  const dirk = readFileSync(path.join(process.cwd(), "app/api/next/dirk/route.ts"), "utf8");
  assert.match(route, /resolveMachineActor/);
  assert.match(route, /Unauthorized/);
  assert.match(route, /loadNextDealStats/);
  assert.match(route, /ok: true/);
  assert.doesNotMatch(route, /currentMember/);
  assert.match(middleware, /\/api\/next\/stats/);
  assert.match(dirk, /resolveMachineActor/);
});
