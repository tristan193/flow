import { test, before } from "node:test";
import assert from "node:assert/strict";

import { query } from "../db.ts";
import { createNextDealFromCim } from "./cim-create.ts";
import { listNextInboxDeals } from "./deals.ts";
import { applyNextVerdicts, upsertNextDeals } from "./import.ts";
import { collapseNextDuplicates, ensureNextSourceDealIdUnique } from "./merge.ts";
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

test("concurrent Axial posts mint one TLY, not two", async () => {
  await resetNext();
  const deal = {
    title: "Auto Wash Platform",
    html: AXIAL_HTML,
    nickname: "aaaabbbbccccdddd",
    source: "axial.net",
  };
  const [a, b] = await Promise.all([upsertNextDeals([deal]), upsertNextDeals([deal])]);
  const rows = await query<{ deal_number: string; source_deal_id: string }>(
    "SELECT deal_number, source_deal_id FROM deals_next ORDER BY id",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_deal_id, "axial:aaaabbbbccccdddd");
  assert.equal(a.dealsNew + b.dealsNew, 1);
  assert.equal(a.dealsUpdated + b.dealsUpdated, 1);
});

test("second identical import is dealsUpdated only", async () => {
  await resetNext();
  const deal = {
    title: "Dual-trade HVAC",
    html: AXIAL_HTML,
    nickname: "aaaabbbbccccdddd",
  };
  const first = await upsertNextDeals([deal]);
  const second = await upsertNextDeals([deal]);
  assert.equal(first.dealsNew, 1);
  assert.equal(first.dealsUpdated, 0);
  assert.equal(second.dealsNew, 0);
  assert.equal(second.dealsUpdated, 1);
  const [{ count }] = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM deals_next");
  assert.equal(Number(count), 1);
});

test("harvest ext_id does not join two different listings", async () => {
  await resetNext();
  const first = await upsertNextDeals([
    {
      title: "Shop A",
      extId: "axial.teaser:18abc:0",
      html: '<a href="https://network.axial.net/app/opportunity/aaaabbbbccccdddd?action=pursue">Pursue</a>',
    },
  ]);
  const second = await upsertNextDeals([
    {
      title: "Shop B totally different",
      extId: "axial.teaser:18abc:0",
      html: '<a href="https://network.axial.net/app/opportunity/ffffeeeebbbbcccc?action=pursue">Pursue</a>',
      state: "TX",
      brokerFirm: "Other",
    },
  ]);
  assert.equal(first.dealsNew, 1);
  assert.equal(second.dealsNew, 1);
  const rows = await query<{ deal_number: string }>("SELECT deal_number FROM deals_next");
  assert.equal(rows.length, 2);
});

test("ingest stage and verdicts move inbox via moveNextStage path", async () => {
  await resetNext();
  const created = await upsertNextDeals([
    {
      title: "Fiber contractor",
      html: AXIAL_HTML,
      proposedStage: "shortlist",
    },
  ]);
  assert.equal(created.dealsNew, 1);
  const [row] = await query<{ stage: string; deal_number: string }>(
    "SELECT stage, deal_number FROM deals_next",
  );
  assert.equal(row.stage, "shortlist");

  await resetNext();
  await upsertNextDeals([{ title: "Pass me", html: AXIAL_HTML }]);
  const [inbox] = await query<{ deal_number: string; stage: string }>(
    "SELECT deal_number, stage FROM deals_next",
  );
  assert.equal(inbox.stage, "inbox");
  const applied = await applyNextVerdicts([
    { dealNumber: inbox.deal_number, member: "tristan", action: "pass" },
  ]);
  assert.equal(applied, 1);
  const [stillInbox] = await query<{ stage: string }>("SELECT stage FROM deals_next");
  assert.equal(stillInbox.stage, "inbox");
  await applyNextVerdicts([
    { dealNumber: inbox.deal_number, member: "partner", action: "pass" },
  ]);
  const [closed] = await query<{ stage: string }>("SELECT stage FROM deals_next");
  assert.equal(closed.stage, "closed");

  await resetNext();
  await upsertNextDeals([{ title: "Short me", html: AXIAL_HTML }]);
  const [open] = await query<{ deal_number: string }>("SELECT deal_number FROM deals_next");
  await applyNextVerdicts([{ dealNumber: open.deal_number, member: "partner", action: "short" }]);
  const [short] = await query<{ stage: string }>("SELECT stage FROM deals_next");
  assert.equal(short.stage, "shortlist");
});

test("merge keeps lowest TLY and deletes Axial hex duplicates", async () => {
  await resetNext();
  await query(
    `INSERT INTO deals_next (deal_number, source_deal_id, source_ids, alias_names, gmail_thread_ids, title, nickname)
     VALUES
       ('TLY-003', 'axial:aaaabbbbccccdddd', '[{"kind":"axial","value":"aaaabbbbccccdddd","canonical":"axial:aaaabbbbccccdddd"}]'::jsonb, '["Auto wash"]'::jsonb, '["thread-keep"]'::jsonb, 'Auto wash', 'aaaabbbbccccdddd'),
       ('TLY-023', 'axial:aaaabbbbccccdddd', '[{"kind":"axial","value":"aaaabbbbccccdddd","canonical":"axial:aaaabbbbccccdddd"}]'::jsonb, '["Auto Wash Co"]'::jsonb, '["thread-dup"]'::jsonb, 'Auto Wash Co', 'aaaabbbbccccdddd')`,
  );
  await query(`UPDATE next_deal_counters SET next_n = 24 WHERE key = 'tly'`);

  const result = await collapseNextDuplicates({
    keepDealNumbers: ["TLY-003"],
    deleteDealNumbers: ["TLY-023"],
  });
  assert.equal(result.deleted, 1);
  assert.equal(result.groups[0]?.keep, "TLY-003");
  const rows = await query<{ deal_number: string; alias_names: unknown; gmail_thread_ids: unknown }>(
    "SELECT deal_number, alias_names, gmail_thread_ids FROM deals_next",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deal_number, "TLY-003");
  const aliases = Array.isArray(rows[0].alias_names)
    ? rows[0].alias_names.map(String)
    : [];
  const threads = Array.isArray(rows[0].gmail_thread_ids)
    ? rows[0].gmail_thread_ids.map(String)
    : [];
  assert.ok(aliases.some((a) => /auto wash/i.test(a)));
  assert.ok(threads.includes("thread-keep"));
  assert.ok(threads.includes("thread-dup"));
  assert.equal(result.uniqueIndexReady, true);

  const again = await upsertNextDeals([
    {
      title: "Auto wash",
      html: AXIAL_HTML,
      nickname: "aaaabbbbccccdddd",
    },
  ]);
  assert.equal(again.dealsNew, 0);
  assert.equal(again.dealsUpdated, 1);
  const [{ count }] = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM deals_next");
  assert.equal(Number(count), 1);
});

test("unique source_deal_id index is created when no duplicates remain", async () => {
  await resetNext();
  await upsertNextDeals([{ title: "Only one", html: AXIAL_HTML }]);
  assert.equal(await ensureNextSourceDealIdUnique(), true);
});

test("token moves TLY from cim to dead; missing token 401; bad stage 400; session still works", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = "test-dirk-token";
  try {
    const minted = await upsertNextDeals([
      { title: "Diamond Gate Security", html: AXIAL_HTML, stage: "cim" },
    ]);
    assert.equal(minted.dealsNew, 1);
    const [row] = await query<{ id: number; deal_number: string; stage: string; stage_changed_by: string | null }>(
      "SELECT id, deal_number, stage, stage_changed_by FROM deals_next",
    );
    assert.equal(row.stage, "cim");
    assert.equal(row.stage_changed_by, "dirk");
    assert.match(row.deal_number, /^TLY-00\d$/);

    const noToken = await applyAuthorizedNextStage({
      authorization: null,
      sessionMember: null,
      dealNumber: row.deal_number,
      stage: "closed",
    });
    assert.equal(noToken.ok, false);
    if (!noToken.ok) assert.equal(noToken.status, 401);

    const badToken = await applyAuthorizedNextStage({
      authorization: "Bearer wrong-token",
      sessionMember: null,
      dealNumber: row.deal_number,
      stage: "closed",
    });
    assert.equal(badToken.ok, false);
    if (!badToken.ok) assert.equal(badToken.status, 401);

    const badStage = await applyAuthorizedNextStage({
      authorization: "Bearer test-dirk-token",
      sessionMember: null,
      dealNumber: row.deal_number,
      stage: "not-a-stage",
    });
    assert.equal(badStage.ok, false);
    if (!badStage.ok) assert.equal(badStage.status, 400);

    const missing = await applyAuthorizedNextStage({
      authorization: "Bearer test-dirk-token",
      sessionMember: null,
      dealNumber: "TLY-999",
      stage: "dead",
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 404);

    const moved = await applyAuthorizedNextStage({
      authorization: "Bearer test-dirk-token",
      sessionMember: null,
      dealNumber: row.deal_number,
      stage: "closed",
      reason: "pass",
      note: "Simon passed Diamond Gate",
    });
    assert.equal(moved.ok, true);
    if (moved.ok) {
      assert.equal(moved.stage, "closed");
      assert.equal(moved.actor, "dirk");
    }
    const [after] = await query<{ stage: string; stage_changed_by: string | null }>(
      "SELECT stage, stage_changed_by FROM deals_next WHERE id = $1",
      [row.id],
    );
    assert.equal(after.stage, "closed");
    assert.equal(after.stage_changed_by, "dirk");
    const notes = await query<{ body: string }>("SELECT body FROM notes_next WHERE deal_id = $1", [row.id]);
    assert.ok(notes.some((n) => /Diamond Gate/i.test(n.body)));

    await query(`UPDATE deals_next SET stage = 'cim' WHERE id = $1`, [row.id]);
    const sessioned = await applyAuthorizedNextStage({
      authorization: null,
      sessionMember: "tristan",
      dealId: row.id,
      stage: "shortlist",
    });
    assert.equal(sessioned.ok, true);
    const [fromSession] = await query<{ stage: string; stage_changed_by: string | null }>(
      "SELECT stage, stage_changed_by FROM deals_next WHERE id = $1",
      [row.id],
    );
    assert.equal(fromSession.stage, "shortlist");
    assert.equal(fromSession.stage_changed_by, "tristan");
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("duplicate Axial HVAC teaser updates the same TLY instead of minting", async () => {
  await resetNext();
  const first = await upsertNextDeals([
    {
      title: "Dual-Trade HVAC Service and Repair Platform",
      html: AXIAL_HTML,
      nickname: "aaaabbbbccccdddd",
    },
  ]);
  assert.equal(first.dealsNew, 1);
  const [row] = await query<{ deal_number: string }>("SELECT deal_number FROM deals_next");
  const again = await upsertNextDeals([
    {
      title: "Dual-Trade HVAC Service and Repair Platform",
      html: AXIAL_HTML,
      nickname: "aaaabbbbccccdddd",
    },
  ]);
  assert.equal(again.dealsNew, 0);
  assert.equal(again.dealsUpdated, 1);
  assert.deepEqual(again.dealIds, first.dealIds);
  const rows = await query<{ deal_number: string }>("SELECT deal_number FROM deals_next");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deal_number, row.deal_number);
});

test("CIM add skips inbound Review and lands at CIM; harvest stays inbound", async () => {
  await resetNext();
  const minted = await createNextDealFromCim("tristan", {
    title: "Rainwater Harvesting Systems",
    blurb: "Commercial rainwater capture.",
    city: "Austin",
    state: "TX",
    revenue: 4_200_000,
    ebitda: 900_000,
    sde: null,
    asking: null,
    businessModelType: "LOCAL_SERVICE",
    url: "https://network.axial.net/app/opportunity/8932140e5f5c4c3b95ab30edf15588cb?action=pursue",
  });
  assert.equal(minted.stage, "cim");
  assert.equal(minted.nickname, "Manual");
  assert.equal((await listNextInboxDeals()).length, 0);

  await resetNext();
  const harvest = await upsertNextDeals([
    {
      title: "Dual-Trade HVAC Service and Repair Platform",
      html: AXIAL_HTML,
      nickname: "aaaabbbbccccdddd",
    },
  ]);
  assert.equal(harvest.dealsNew, 1);
  const [open] = await query<{ deal_number: string; stage: string }>(
    "SELECT deal_number, stage FROM deals_next",
  );
  assert.equal(open.stage, "inbox");

  const joined = await createNextDealFromCim("tristan", {
    title: "Confidential Information Memorandum — HVAC Platform",
    blurb: "Same shop, CIM retitle.",
    city: "Austin",
    state: "TX",
    revenue: 6_000_000,
    ebitda: 1_100_000,
    sde: null,
    asking: null,
    businessModelType: "REGIONAL",
    url: "https://network.axial.net/app/opportunity/aaaabbbbccccdddd?action=pursue",
  });
  assert.equal(joined.deal_number, open.deal_number);
  assert.equal(joined.stage, "cim");
  const after = await query<{ deal_number: string }>("SELECT deal_number FROM deals_next");
  assert.equal(after.length, 1);
  assert.equal((await listNextInboxDeals()).length, 0);
});

test("Pursuing cards stay off the Review inbox list", async () => {
  await resetNext();
  await upsertNextDeals([
    { title: "Rainwater Harvesting", html: AXIAL_HTML, stage: "pursuing" },
  ]);
  const inbox = await listNextInboxDeals();
  assert.equal(inbox.length, 0);
  const [row] = await query<{ stage: string }>(
    "SELECT stage FROM deals_next WHERE title = 'Rainwater Harvesting'",
  );
  assert.equal(row.stage, "pursuing");
});
