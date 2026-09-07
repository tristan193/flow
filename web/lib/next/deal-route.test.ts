import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { query } from "../db.ts";
import {
  getNextDeal,
  getNextDealByRouteParam,
  nextDealPublicPath,
  parseNextDealRouteParam,
} from "./deals.ts";

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

test("route params accept TLY-XXX, padded 013, and numeric DB ids", () => {
  assert.deepEqual(parseNextDealRouteParam("TLY-013"), { kind: "number", dealNumber: "TLY-013" });
  assert.deepEqual(parseNextDealRouteParam("tly-13"), { kind: "number", dealNumber: "TLY-013" });
  assert.deepEqual(parseNextDealRouteParam("013"), { kind: "number", dealNumber: "TLY-013" });
  assert.deepEqual(parseNextDealRouteParam("13"), { kind: "id", id: 13 });
  assert.deepEqual(parseNextDealRouteParam("123"), { kind: "id", id: 123 });
  assert.equal(parseNextDealRouteParam("BBS-99"), null);
  assert.equal(parseNextDealRouteParam("foo"), null);
  assert.equal(parseNextDealRouteParam(""), null);
  assert.equal(nextDealPublicPath("tly-13"), "/next/deals/TLY-013");
  assert.equal(nextDealPublicPath("nope"), null);
});

test("/next/deals/TLY-013 and numeric id resolve the same deal; unknown TLY is missing", async () => {
  await resetNext();
  await query(`INSERT INTO deals_next (deal_number, title) VALUES ($1, $2)`, [
    "TLY-013",
    "Punch list fixture",
  ]);
  const [row] = await query<{ id: number }>("SELECT id FROM deals_next WHERE deal_number = 'TLY-013'");
  assert.ok(row);
  const byId = await getNextDeal(row.id);
  assert.equal(byId?.deal_number, "TLY-013");

  const lookups = await Promise.all([
    getNextDealByRouteParam("TLY-013"),
    getNextDealByRouteParam("tly-013"),
    getNextDealByRouteParam("TLY-13"),
    getNextDealByRouteParam("013"),
    getNextDealByRouteParam(String(row.id)),
  ]);
  for (const deal of lookups) {
    assert.ok(deal);
    assert.equal(deal.id, row.id);
    assert.equal(deal.deal_number, "TLY-013");
    assert.equal(deal.title, "Punch list fixture");
  }

  assert.equal(await getNextDealByRouteParam("TLY-999"), null);
  assert.equal(await getNextDealByRouteParam("not-a-deal"), null);
});

test("deal detail page looks up by route param, not Number(id) only", () => {
  const page = readFileSync(path.join(process.cwd(), "app/next/deals/[id]/page.tsx"), "utf8");
  assert.match(page, /getNextDealByRouteParam/);
  assert.match(page, /notFound\(\)/);
  assert.doesNotMatch(page, /const dealId = Number\(id\)/);
});
