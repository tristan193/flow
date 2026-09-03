import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { query } from "../db.ts";
import {
  getNextDeal,
  listNextCimDeals,
  listNextInboxDeals,
  setNextCimVerdict,
  setNextVerdict,
} from "./deals.ts";
import { upsertNextDeals } from "./import.ts";
import { applyAuthorizedNextStage } from "./stage-auth.ts";
import { nextCimDeck } from "./model.ts";

const AXIAL_HTML =
  '<a href="https://network.axial.net/app/opportunity/aaaabbbbccccdddd?action=pursue">Pursue</a>';
const FILE_URL = "https://drive.google.com/file/d/abcFile092/view";

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
  await query("DROP INDEX IF EXISTS ux_deals_next_source_deal_id");
}

before(async () => {
  await query("SELECT 1");
});

test("CIM deck includes every stage CIM row and stamped-URL board rows", async () => {
  await resetNext();
  const html = (hex: string) =>
    `<a href="https://network.axial.net/app/opportunity/${hex}?action=pursue">Pursue</a>`;
  await upsertNextDeals([{ title: "Project Cactus", html: html("aaaabbbbcccc0001"), stage: "cim" }]);
  await upsertNextDeals([{ title: "Iron Bull", html: html("aaaabbbbcccc0002"), stage: "nda" }]);
  await upsertNextDeals([
    { title: "Water Infrastructure", html: html("aaaabbbbcccc0004"), stage: "cim" },
  ]);
  await upsertNextDeals([{ title: "Inbound teaser", html: html("aaaabbbbcccc0003"), ebitda: 600_000 }]);

  const cactus = await query<{ id: number; deal_number: string }>(
    "SELECT id, deal_number FROM deals_next WHERE title = 'Project Cactus'",
  );
  const iron = await query<{ id: number; deal_number: string }>(
    "SELECT id, deal_number FROM deals_next WHERE title = 'Iron Bull'",
  );
  const water = await query<{ id: number; deal_number: string; stage: string }>(
    "SELECT id, deal_number, stage FROM deals_next WHERE title = 'Water Infrastructure'",
  );
  await query(`UPDATE deals_next SET deal_number = 'TLY-092', cim_url = $1 WHERE id = $2`, [
    FILE_URL,
    cactus[0].id,
  ]);
  await query(`UPDATE deals_next SET deal_number = 'TLY-031', cim_url = $1 WHERE id = $2`, [
    FILE_URL,
    iron[0].id,
  ]);
  await query(`UPDATE deals_next SET deal_number = 'TLY-001', cim_url = NULL WHERE id = $1`, [
    water[0].id,
  ]);

  const cim = await listNextCimDeals();
  const numbers = cim.map((deal) => deal.deal_number).sort();
  assert.deepEqual(numbers, ["TLY-001", "TLY-031", "TLY-092"]);
  assert.equal(
    cim.some((deal) => deal.deal_number === "TLY-001" && deal.title === "Water Infrastructure"),
    true,
  );
  const waterAfter = await query<{ stage: string; cim_url: string | null }>(
    "SELECT stage, cim_url FROM deals_next WHERE deal_number = 'TLY-001'",
  );
  assert.equal(waterAfter[0].stage, "cim");
  assert.equal(waterAfter[0].cim_url, null);
  assert.equal(
    cim.every((deal) => deal.cim_verdicts && !("simon" in deal.cim_verdicts)),
    true,
  );

  const inbox = await listNextInboxDeals();
  assert.equal(inbox.some((deal) => deal.title === "Inbound teaser"), true);
  assert.equal(inbox.some((deal) => deal.title === "Project Cactus"), false);
});

test("Review Likes do not auto-Pursue a CIM card; both CIM Pursue does", async () => {
  await resetNext();
  await upsertNextDeals([{ title: "Both liked inbound", html: AXIAL_HTML, stage: "cim" }]);
  const [row] = await query<{ id: number }>("SELECT id FROM deals_next");
  await setNextVerdict(row.id, "tristan", "short", null);
  await setNextVerdict(row.id, "partner", "short", null);
  const afterReview = await getNextDeal(row.id);
  assert.equal(afterReview?.stage, "cim");
  assert.deepEqual(afterReview?.cim_verdicts, {});

  await setNextCimVerdict(row.id, "tristan", "short");
  const oneVote = await getNextDeal(row.id);
  assert.equal(oneVote?.stage, "cim");

  await setNextCimVerdict(row.id, "partner", "discuss");
  const hold = await getNextDeal(row.id);
  assert.equal(hold?.stage, "cim");

  await setNextCimVerdict(row.id, "partner", "short");
  const both = await getNextDeal(row.id);
  assert.equal(both?.stage, "pursuing");
});

test("both CIM Pass closes; Hold and mixed stay CIM; Simon is not a voter", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = "test-cim-token";
  try {
    await upsertNextDeals([{ title: "Will close", html: AXIAL_HTML, stage: "cim" }]);
    const [row] = await query<{ id: number; deal_number: string }>(
      "SELECT id, deal_number FROM deals_next",
    );
    await query(
      `INSERT INTO cim_verdicts_next (deal_id, member, action) VALUES ($1, 'simon', 'short')`,
      [row.id],
    );
    const withSimon = await getNextDeal(row.id);
    assert.equal(withSimon?.cim_verdicts.tristan, undefined);
    assert.equal(withSimon?.cim_verdicts.partner, undefined);
    assert.ok(!("simon" in (withSimon?.cim_verdicts ?? {})));

    await setNextCimVerdict(row.id, "tristan", "pass");
    await setNextCimVerdict(row.id, "partner", "pass");
    const closed = await getNextDeal(row.id);
    assert.equal(closed?.stage, "closed");

    await upsertNextDeals([{ title: "Dirk moves", html: AXIAL_HTML, stage: "cim" }]);
    const [other] = await query<{ id: number; deal_number: string }>(
      "SELECT id, deal_number FROM deals_next WHERE title = 'Dirk moves'",
    );
    const moved = await applyAuthorizedNextStage({
      authorization: "Bearer test-cim-token",
      sessionMember: null,
      dealNumber: other.deal_number,
      stage: "closed",
    });
    assert.equal(moved.ok, true);
    const after = await getNextDeal(other.id);
    assert.equal(after?.stage, "closed");
    const cimOnly = await listNextCimDeals();
    assert.equal(
      cimOnly.some((deal) => deal.id === other.id),
      false,
    );
    assert.deepEqual(
      nextCimDeck(cimOnly, "tristan").map((deal) => deal.id),
      [],
    );
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("CIM Review UI opens /cim/TLY-XXX in a new tab and does not call Google", () => {
  const client = readFileSync(path.join(process.cwd(), "components/next/cim-review-client.tsx"), "utf8");
  const page = readFileSync(path.join(process.cwd(), "app/next/page.tsx"), "utf8");
  const review = readFileSync(path.join(process.cwd(), "components/next/review-client.tsx"), "utf8");
  const verdict = readFileSync(path.join(process.cwd(), "app/api/next/cim/verdict/route.ts"), "utf8");
  assert.match(client, /View CIM/);
  assert.match(client, /target="_blank"/);
  assert.match(client, /rel="noopener noreferrer"/);
  assert.match(client, /cimPackPath/);
  assert.doesNotMatch(client, /googleapis|files\.create|GOOGLE_SERVICE_ACCOUNT/);
  assert.doesNotMatch(page, /googleapis|resolveCimDriveLinks|GOOGLE_SERVICE_ACCOUNT/);
  assert.doesNotMatch(verdict, /googleapis|GOOGLE_SERVICE_ACCOUNT/);
  assert.match(page, /listNextCimDeals/);
  assert.doesNotMatch(review, /Browse everything in List view/);
  assert.doesNotMatch(review, /setMode|"swipe" \| "list"/);
  assert.match(review, /FitStrip/);
  assert.doesNotMatch(client, /\/api\/next\/notes/);
  assert.doesNotMatch(client, /partnerNotesOnly/);
  assert.doesNotMatch(client, /FitStrip/);
  assert.doesNotMatch(client, /No financials|no earnings/);
  assert.match(client, /SuperLikeStar/);
  assert.match(client, /CimPackMetrics/);
  assert.doesNotMatch(client, /Written review/);
  assert.doesNotMatch(page, /listNextNotesForDeals|partnerNotesOnly|notesByDealId/);
});
