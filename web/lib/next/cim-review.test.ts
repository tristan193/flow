import { test, before } from "node:test";
import assert from "node:assert/strict";

import { query } from "../db.ts";
import { dealNumberFromFolderName, indexCimFolders } from "./cim-drive.ts";
import {
  applyAuthorizedCimLink,
  applyAuthorizedCimReview,
  applyAuthorizedNextNote,
} from "./cim-review.ts";
import {
  getNextDeal,
  listNextCimDeals,
  listNextNotes,
  setNextCimVerdict,
  setNextVerdict,
} from "./deals.ts";
import { upsertNextDeals } from "./import.ts";
import { applyAuthorizedNextStage } from "./stage-auth.ts";

const AXIAL_HTML =
  '<a href="https://network.axial.net/app/opportunity/aaaabbbbccccdddd?action=pursue">Pursue</a>';

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

test("TLY- prefix from Drive folder names", () => {
  assert.equal(dealNumberFromFolderName("TLY-007 Headline"), "TLY-007");
  assert.equal(dealNumberFromFolderName("tly-7  HVAC"), "TLY-007");
  assert.equal(dealNumberFromFolderName("TLY-042"), "TLY-042");
  assert.equal(dealNumberFromFolderName("Headline TLY-007"), null);
  const index = indexCimFolders([
    { id: "folderA", name: "TLY-007 Security pack" },
    { id: "skip", name: "Not a TLY folder" },
  ]);
  assert.equal(index.get("TLY-007")?.url, "https://drive.google.com/drive/folders/folderA");
  assert.equal(index.has("TLY-001"), false);
});

test("token can set Drive CIM url and Simon review without a verdict", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = "test-cim-token";
  try {
    await upsertNextDeals([{ title: "Diamond Gate", html: AXIAL_HTML, stage: "cim" }]);
    const [row] = await query<{ id: number; deal_number: string }>(
      "SELECT id, deal_number FROM deals_next",
    );
    const drive = "https://drive.google.com/drive/folders/abcCIM007xyz";

    const noAuth = await applyAuthorizedCimLink({
      authorization: null,
      sessionMember: null,
      dealNumber: row.deal_number,
      url: drive,
    });
    assert.equal(noAuth.ok, false);
    if (!noAuth.ok) assert.equal(noAuth.status, 401);

    const linked = await applyAuthorizedCimLink({
      authorization: "Bearer test-cim-token",
      sessionMember: null,
      dealNumber: row.deal_number,
      url: drive,
    });
    assert.equal(linked.ok, true);

    const reviewed = await applyAuthorizedCimReview({
      authorization: "Bearer test-cim-token",
      sessionMember: null,
      dealNumber: row.deal_number,
      actor: "simon",
      review: "Solid margin. Customer concentration is the flag.",
    });
    assert.equal(reviewed.ok, true);
    if (reviewed.ok) assert.equal(reviewed.actor, "simon");

    const asMember = await applyAuthorizedNextNote({
      authorization: "Bearer test-cim-token",
      sessionMember: null,
      dealNumber: row.deal_number,
      actor: "tristan",
      body: "I pass",
    });
    assert.equal(asMember.ok, false);

    const deal = await getNextDeal(row.id);
    assert.equal(deal?.cim_url, drive);
    assert.equal(deal?.stage, "cim");
    assert.deepEqual(deal?.cim_verdicts, {});
    assert.deepEqual(deal?.verdicts, {});
    const notes = await listNextNotes(row.id);
    assert.equal(notes[0]?.member, "simon");
    assert.match(notes[0]?.body ?? "", /Solid margin/);
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("Review Likes do not auto-Pursue a CIM card; both CIM Pursue does", async () => {
  await resetNext();
  await upsertNextDeals([{ title: "Both liked inbound", html: AXIAL_HTML, stage: "cim" }]);
  const [row] = await query<{ id: number }>("SELECT id FROM deals_next");
  await setNextVerdict(row.id, "tristan", "short", null);
  await setNextVerdict(row.id, "partner", "short", null);
  const afterReview = await getNextDeal(row.id);
  assert.equal(afterReview?.stage, "cim");

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

test("both CIM Pass closes; Dirk stage still works", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = "test-cim-token";
  try {
    await upsertNextDeals([{ title: "Will close", html: AXIAL_HTML, stage: "cim" }]);
    const [row] = await query<{ id: number; deal_number: string }>(
      "SELECT id, deal_number FROM deals_next",
    );
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
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});
