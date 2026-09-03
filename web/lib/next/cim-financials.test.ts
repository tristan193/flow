import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "path";

import { query } from "../db.ts";
import {
  applyAuthorizedCimFinancials,
  parseCimFinancialsPatch,
  parseOptionalMargin,
} from "./cim-financials-auth.ts";
import { cimPackMetricSlots } from "./model.ts";

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

test("deals_next.margin column exists (no parallel stats table)", async () => {
  const cols = await query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_name = 'deals_next'
        AND column_name IN ('revenue', 'ebitda', 'asking', 'margin')
      ORDER BY column_name`,
  );
  assert.deepEqual(
    cols.map((row) => row.column_name),
    ["asking", "ebitda", "margin", "revenue"],
  );
  const extra = await query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_name IN ('cim_financials', 'cim_stats', 'deal_stats_next')`,
  );
  assert.equal(extra.length, 0);
});

test("parseCimFinancialsPatch accepts partial fields and percent margin", () => {
  const parsed = parseCimFinancialsPatch({
    dealNumber: "tly-092",
    ebitda: "920,000",
    margin: 22,
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.dealNumber, "TLY-092");
    assert.deepEqual(parsed.patch, { ebitda: 920_000, margin: 0.22 });
  }

  const ratio = parseOptionalMargin(0.18);
  assert.equal(ratio.ok, true);
  if (ratio.ok) assert.equal(ratio.value, 0.18);

  const empty = parseCimFinancialsPatch({ dealNumber: "TLY-092" });
  assert.equal(empty.ok, false);

  const bad = parseCimFinancialsPatch({ dealNumber: "TLY-092", revenue: "abc" });
  assert.equal(bad.ok, false);
});

test("cimPackMetricSlots omits missing fields and never invents No financials", () => {
  assert.deepEqual(
    cimPackMetricSlots({ revenue: 4_200_000, ebitda: 920_000, margin: 0.22, asking: null }),
    [
      { label: "revenue", value: "$4.2M" },
      { label: "EBITDA", value: "$920K" },
      { label: "margin", value: "22%" },
    ],
  );
  assert.deepEqual(
    cimPackMetricSlots({ revenue: null, ebitda: null, margin: null, asking: null }),
    [],
  );
  assert.deepEqual(
    cimPackMetricSlots({ revenue: null, ebitda: null, margin: null, asking: 6_500_000 }),
    [{ label: "asking", value: "$6.5M" }],
  );
  // SDE-only must not appear as EBITDA
  assert.deepEqual(
    cimPackMetricSlots({ revenue: 1_000_000, ebitda: null, margin: null, asking: null }),
    [{ label: "revenue", value: "$1.0M" }],
  );
});

test("token can patch CIM financials by TLY; session cannot; stage stays put", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = "test-dirk-cim-fin";
  try {
    await query(
      `INSERT INTO deals_next (deal_number, title, stage, revenue, ebitda)
       VALUES ($1, $2, $3, $4, $5)`,
      ["TLY-092", "Project Cactus", "cim", 1_000_000, 200_000],
    );

    const noToken = await applyAuthorizedCimFinancials({
      authorization: null,
      dealNumber: "TLY-092",
      revenue: 4_200_000,
    });
    assert.equal(noToken.ok, false);
    if (!noToken.ok) assert.equal(noToken.status, 401);

    const missing = await applyAuthorizedCimFinancials({
      authorization: "Bearer test-dirk-cim-fin",
      dealNumber: "TLY-031",
      ebitda: 100,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 404);

    const patched = await applyAuthorizedCimFinancials({
      authorization: "Bearer test-dirk-cim-fin",
      dealNumber: "tly-092",
      revenue: 4_200_000,
      ebitda: 920_000,
      margin: 22,
    });
    assert.equal(patched.ok, true);
    if (patched.ok) {
      assert.equal(patched.dealNumber, "TLY-092");
      assert.equal(patched.revenue, 4_200_000);
      assert.equal(patched.ebitda, 920_000);
      assert.equal(patched.margin, 0.22);
      assert.equal(patched.asking, null);
      assert.equal(patched.stage, "cim");
    }

    const askingOnly = await applyAuthorizedCimFinancials({
      authorization: "Bearer test-dirk-cim-fin",
      dealNumber: "TLY-092",
      asking: 6_500_000,
    });
    assert.equal(askingOnly.ok, true);
    if (askingOnly.ok) {
      assert.equal(askingOnly.revenue, 4_200_000);
      assert.equal(askingOnly.ebitda, 920_000);
      assert.equal(askingOnly.margin, 0.22);
      assert.equal(askingOnly.asking, 6_500_000);
      assert.equal(askingOnly.stage, "cim");
    }

    const row = await query<{ stage: string; asking: number; revenue: number }>(
      "SELECT stage, asking, revenue FROM deals_next WHERE deal_number = 'TLY-092'",
    );
    assert.equal(row[0].stage, "cim");
    assert.equal(Number(row[0].asking), 6_500_000);
    assert.equal(Number(row[0].revenue), 4_200_000);
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("CIM financials route is token-only and does not write stage", () => {
  const route = readFileSync(path.join(process.cwd(), "app/api/next/cim-financials/route.ts"), "utf8");
  const auth = readFileSync(path.join(process.cwd(), "lib/next/cim-financials-auth.ts"), "utf8");
  assert.match(route, /FLOW_IMPORT_TOKEN/);
  assert.match(route, /applyAuthorizedCimFinancials/);
  assert.doesNotMatch(auth, /SET stage|stage =/);
  assert.match(auth, /Never writes stage/);
});
