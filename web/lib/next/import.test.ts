import { test, before } from "node:test";
import assert from "node:assert/strict";

import { isUniqueViolation, query, withTransaction } from "../db.ts";
import { createNextDealFromCim } from "./cim-create.ts";
import { listNextBoardDeals, listNextInboxDeals } from "./deals.ts";
import { applyNextVerdicts, upsertNextDeals } from "./import.ts";
import { SOURCE_DEAL_ID_UNIQUE_SQL, collapseNextDuplicates, ensureNextSourceDealIdUnique } from "./merge.ts";
import { applyAuthorizedNextStage } from "./stage-auth.ts";

const AXIAL_HTML =
  '<a href="https://network.axial.net/app/opportunity/aaaabbbbccccdddd?action=pursue">Pursue</a>';

async function resetNext() {
  await query(`
    TRUNCATE TABLE
      deal_log,
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

test("merge folds a twin that owns source_deal_id into a null keeper", async () => {
  await resetNext();
  const axialId = "axial:aaaabbbbccccdddd";
  const listingUrl = "https://network.axial.net/app/opportunity/aaaabbbbccccdddd";
  await query(
    `INSERT INTO deals_next (deal_number, source_deal_id, source_ids, title, nickname, url)
     VALUES
       ('TLY-010', NULL, $1::jsonb, 'Keeper shop', 'Axial', $2),
       ('TLY-040', $3, $1::jsonb, 'Remint twin', 'Axial', $2)`,
    [
      JSON.stringify([
        { kind: "axial", value: "aaaabbbbccccdddd", canonical: axialId },
      ]),
      listingUrl,
      axialId,
    ],
  );
  await query(SOURCE_DEAL_ID_UNIQUE_SQL);

  const result = await collapseNextDuplicates({
    pairs: [{ keep: "TLY-010", delete: ["TLY-040"] }],
  });
  assert.equal(result.deleted, 1);
  assert.equal(result.groups[0]?.keep, "TLY-010");

  const rows = await query<{ deal_number: string; source_deal_id: string | null }>(
    "SELECT deal_number, source_deal_id FROM deals_next ORDER BY deal_number",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deal_number, "TLY-010");
  assert.equal(rows[0].source_deal_id, axialId);
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
    // Machine notes are log-only entries now (never on partner cards).
    const notes = await query<{ patch: unknown }>(
      "SELECT patch FROM deal_log WHERE deal_id = $1 AND kind = 'note'",
      [row.id],
    );
    assert.ok(
      notes.some((n) => /Diamond Gate/i.test(JSON.stringify(n.patch))),
    );

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

test("deals_next remint columns exist for Harve ingest", async () => {
  const cols = await query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_name = 'deals_next'
        AND column_name IN ('duplicate_of', 'ingest_disposition')
      ORDER BY column_name`,
  );
  assert.deepEqual(
    cols.map((row) => row.column_name),
    ["duplicate_of", "ingest_disposition"],
  );
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

test("duplicateOf attaches threads to the canonical TLY and does not mint Review", async () => {
  await resetNext();
  const first = await upsertNextDeals([
    {
      title: "Life-Safety Platform",
      html: AXIAL_HTML,
      nickname: "aaaabbbbccccdddd",
      gmailThreadIds: ["thread-canon"],
      blurb: "Original board deal.",
    },
  ]);
  assert.equal(first.dealsNew, 1);
  const [canon] = await query<{ deal_number: string; title: string; blurb: string | null }>(
    "SELECT deal_number, title, blurb FROM deals_next",
  );
  assert.equal(canon.deal_number, "TLY-001");

  const joined = await upsertNextDeals([
    {
      title: "Life-Safety teaser thread",
      html: '<a href="https://network.axial.net/app/opportunity/ffffeeeebbbbcccc?action=pursue">Pursue</a>',
      nickname: "ffffeeeebbbbcccc",
      gmailThreadIds: ["thread-teaser"],
      blurb: "Mid-pipeline/board join: Life-Safety teaser thread → existing TLY-001. Append gmailThreadIds only; no stage change.",
      duplicateOf: "TLY-001",
      ingestDisposition: "attached",
    },
  ]);
  assert.equal(joined.dealsNew, 0);
  assert.equal(joined.dealsUpdated, 1);
  assert.deepEqual(joined.dealIds, first.dealIds);

  const rows = await query<{
    deal_number: string;
    title: string;
    blurb: string | null;
    stage: string;
    gmail_thread_ids: unknown;
    alias_names: unknown;
    duplicate_of: string | null;
  }>("SELECT deal_number, title, blurb, stage, gmail_thread_ids, alias_names, duplicate_of FROM deals_next");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deal_number, "TLY-001");
  assert.equal(rows[0].title, "Life-Safety Platform");
  assert.equal(rows[0].blurb, "Original board deal.");
  assert.equal(rows[0].stage, "inbox");
  assert.equal(rows[0].duplicate_of, null);
  const threads = Array.isArray(rows[0].gmail_thread_ids)
    ? rows[0].gmail_thread_ids.map(String)
    : [];
  assert.ok(threads.includes("thread-canon"));
  assert.ok(threads.includes("thread-teaser"));
  const aliases = Array.isArray(rows[0].alias_names) ? rows[0].alias_names.map(String) : [];
  assert.ok(aliases.some((a) => /teaser/i.test(a)));
  assert.equal((await listNextInboxDeals()).length, 1);
  assert.equal((await listNextInboxDeals())[0].deal_number, "TLY-001");
});

test("remint with unknown duplicateOf mints Closed, never Review", async () => {
  await resetNext();
  const minted = await upsertNextDeals([
    {
      title: "Life-Safety teaser thread",
      html: AXIAL_HTML,
      gmailThreadIds: ["thread-orphan"],
      duplicateOf: "TLY-132",
      ingestDisposition: "remint",
      blurb: "Would have been TLY-212 in Review.",
    },
  ]);
  assert.equal(minted.dealsNew, 1);
  const [row] = await query<{
    deal_number: string;
    stage: string;
    duplicate_of: string | null;
    ingest_disposition: string | null;
  }>("SELECT deal_number, stage, duplicate_of, ingest_disposition FROM deals_next");
  assert.equal(row.deal_number, "TLY-001");
  assert.equal(row.stage, "closed");
  assert.equal(row.duplicate_of, "TLY-132");
  assert.equal(row.ingest_disposition, "remint");
  assert.equal((await listNextInboxDeals()).length, 0);
  const board = await listNextBoardDeals();
  assert.equal(board.length, 1);
  assert.equal(board[0].stage, "closed");
  assert.equal(board[0].duplicate_of, "TLY-132");
  assert.equal(board[0].ingest_disposition, "remint");
});

test("re-post closes an accidental remint card and attaches to the canonical", async () => {
  await resetNext();
  await upsertNextDeals([
    {
      title: "Life-Safety Platform",
      html: AXIAL_HTML,
      nickname: "aaaabbbbccccdddd",
      gmailThreadIds: ["thread-canon"],
    },
  ]);
  await upsertNextDeals([
    {
      title: "Accidental remint card",
      html: '<a href="https://network.axial.net/app/opportunity/ffffeeeebbbbcccc?action=pursue">Pursue</a>',
      nickname: "ffffeeeebbbbcccc",
      gmailThreadIds: ["thread-oops"],
    },
  ]);
  const before = await query<{ deal_number: string; stage: string }>(
    "SELECT deal_number, stage FROM deals_next ORDER BY id",
  );
  assert.equal(before.length, 2);
  assert.equal(before[1].deal_number, "TLY-002");
  assert.equal(before[1].stage, "inbox");
  assert.equal((await listNextInboxDeals()).length, 2);

  const healed = await upsertNextDeals([
    {
      title: "Accidental remint card",
      dealNumber: "TLY-002",
      html: '<a href="https://network.axial.net/app/opportunity/ffffeeeebbbbcccc?action=pursue">Pursue</a>',
      nickname: "ffffeeeebbbbcccc",
      gmailThreadIds: ["thread-oops"],
      duplicateOf: "TLY-001",
      ingestDisposition: "remint",
    },
  ]);
  assert.equal(healed.dealsNew, 0);
  assert.equal(healed.dealsUpdated, 1);

  const rows = await query<{
    deal_number: string;
    stage: string;
    duplicate_of: string | null;
    ingest_disposition: string | null;
    gmail_thread_ids: unknown;
  }>("SELECT deal_number, stage, duplicate_of, ingest_disposition, gmail_thread_ids FROM deals_next ORDER BY id");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].deal_number, "TLY-001");
  assert.equal(rows[0].stage, "inbox");
  const threads = Array.isArray(rows[0].gmail_thread_ids)
    ? rows[0].gmail_thread_ids.map(String)
    : [];
  assert.ok(threads.includes("thread-canon"));
  assert.ok(threads.includes("thread-oops"));
  assert.equal(rows[1].deal_number, "TLY-002");
  assert.equal(rows[1].stage, "closed");
  assert.equal(rows[1].duplicate_of, "TLY-001");
  assert.equal(rows[1].ingest_disposition, "remint");
  const inbox = await listNextInboxDeals();
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].deal_number, "TLY-001");
});

test("skipIfNew does not mint unmatched catalog but still updates a matched TLY", async () => {
  await resetNext();
  const url = "https://www.bizbuysell.com/business-opportunity/hvac-shop/5550123/?q=5550123";
  const first = await upsertNextDeals([{ title: "HVAC Shop", url }]);
  assert.equal(first.dealsNew, 1);

  const skipped = await upsertNextDeals([
    {
      title: "Never seen before",
      url: "https://www.bizbuysell.com/business-opportunity/other-shop/9990001/?q=9990001",
      skipIfNew: true,
    },
  ]);
  assert.equal(skipped.dealsNew, 0);
  assert.equal(skipped.dealsUpdated, 0);
  assert.equal(skipped.skipped, 1);

  const updated = await upsertNextDeals([
    { title: "HVAC Shop LLC", url, skipIfNew: true, revenue: 1_200_000 },
  ]);
  assert.equal(updated.dealsNew, 0);
  assert.equal(updated.dealsUpdated, 1);

  const [{ count }] = await query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM deals_next",
  );
  assert.equal(Number(count), 1);
});

const PCB_AXIAL_ID = "axial:88de30e9a6c7452b8213fdc741a0fefc";
const LAND_AXIAL_ID = "axial:848b7f5e237c47e5b9c07dbb4895c3f0";
const PCB_TITLE = "High-Frequency PCB Manufacturer With Diversified Customers";
const PCB_URL =
  "https://network.axial.net/received-deals/new;id=88de30e9a6c7452b8213fdc741a0fefc;tab=details;action=pursue";
const PCB_URL_ENCODED =
  "https://network.axial.net/received-deals/new%3Bid=88de30e9a6c7452b8213fdc741a0fefc%3Btab=details%3Baction=pursue";

async function seedPcbTwin(opts: {
  url?: string | null;
  nickname?: string;
  sourceIds?: unknown[];
}) {
  await resetNext();
  await query(
    `INSERT INTO deals_next (deal_number, title, source, nickname, url, source_ids, stage)
     VALUES ('TLY-286', $1, 'axial.net', $2, $3, $4::jsonb, 'inbox')`,
    [PCB_TITLE, opts.nickname ?? "Axial", opts.url ?? null, JSON.stringify(opts.sourceIds ?? [])],
  );
  await query(
    `INSERT INTO deals_next (deal_number, source_deal_id, title, source, nickname, stage)
     VALUES ('TLY-259', $1, 'PCB manufacturer — keeper', 'axial.net', 'Axial', 'shortlist')`,
    [PCB_AXIAL_ID],
  );
  await query(SOURCE_DEAL_ID_UNIQUE_SQL);
}

async function importPcbBesideLandscaping(incoming: {
  url?: string;
  nickname?: string;
  sourceDealId?: string | null;
}) {
  return upsertNextDeals([
    {
      title: PCB_TITLE,
      source: "axial.net",
      nickname: incoming.nickname ?? "Axial",
      sourceDealId: "sourceDealId" in incoming ? incoming.sourceDealId : PCB_AXIAL_ID,
      url: incoming.url,
    },
    {
      title: "CT landscaping add-on",
      source: "axial.net",
      sourceDealId: LAND_AXIAL_ID,
    },
  ]);
}

async function assertKeeperAttached() {
  const rows = await query<{
    deal_number: string;
    source_deal_id: string | null;
    title: string;
    stage: string;
  }>("SELECT deal_number, source_deal_id, title, stage FROM deals_next ORDER BY deal_number");
  const keeper = rows.find((r) => r.deal_number === "TLY-259");
  const twin = rows.find((r) => r.deal_number === "TLY-286");
  const land = rows.find((r) => r.source_deal_id === LAND_AXIAL_ID);
  assert.ok(keeper);
  assert.equal(keeper.source_deal_id, PCB_AXIAL_ID);
  assert.equal(keeper.title, PCB_TITLE);
  assert.equal(keeper.stage, "shortlist");
  assert.ok(twin);
  assert.equal(twin.source_deal_id, null);
  assert.equal(twin.title, PCB_TITLE);
  assert.ok(land);
  assert.equal(rows.length, 3);
}

test("posted sourceDealId updates the column owner when a title twin has a null id", async () => {
  await seedPcbTwin({});
  const result = await importPcbBesideLandscaping({});
  assert.equal(result.dealsUpdated, 1);
  assert.equal(result.dealsNew, 1);
  assert.equal(result.skipped, 0);
  await assertKeeperAttached();
});

test("listing URL twin does not take a sourceDealId the keeper already owns", async () => {
  await seedPcbTwin({ url: PCB_URL });
  const result = await importPcbBesideLandscaping({ url: PCB_URL });
  assert.equal(result.dealsUpdated, 1);
  assert.equal(result.dealsNew, 1);
  await assertKeeperAttached();
});

test("nickname-hex twin does not take a sourceDealId the keeper already owns", async () => {
  await seedPcbTwin({ nickname: "88de30e9a6c7452b8213fdc741a0fefc" });
  const result = await importPcbBesideLandscaping({
    nickname: "88de30e9a6c7452b8213fdc741a0fefc",
  });
  assert.equal(result.dealsUpdated, 1);
  assert.equal(result.dealsNew, 1);
  await assertKeeperAttached();
});

test("source_ids jsonb twin does not take a sourceDealId the keeper already owns", async () => {
  await seedPcbTwin({
    sourceIds: [
      {
        kind: "axial",
        value: "88de30e9a6c7452b8213fdc741a0fefc",
        canonical: PCB_AXIAL_ID,
      },
    ],
  });
  const result = await importPcbBesideLandscaping({});
  assert.equal(result.dealsUpdated, 1);
  assert.equal(result.dealsNew, 1);
  await assertKeeperAttached();
});

test("percent-encoded Axial URL attaches to the sourceDealId owner", async () => {
  await seedPcbTwin({ url: PCB_URL });
  const result = await importPcbBesideLandscaping({ url: PCB_URL_ENCODED, sourceDealId: PCB_AXIAL_ID });
  assert.equal(result.dealsUpdated, 1);
  assert.equal(result.dealsNew, 1);
  await assertKeeperAttached();

  await seedPcbTwin({ url: PCB_URL });
  const fromUrlOnly = await importPcbBesideLandscaping({
    url: PCB_URL_ENCODED,
    sourceDealId: undefined,
  });
  assert.equal(fromUrlOnly.dealsUpdated, 1);
  assert.equal(fromUrlOnly.dealsNew, 1);
  await assertKeeperAttached();
});

test("isUniqueViolation sees wrapped 23505 and ignores an aborted-transaction error", () => {
  assert.equal(isUniqueViolation({ code: "23505", message: "duplicate key" }), true);
  assert.equal(
    isUniqueViolation({
      message: 'duplicate key value violates unique constraint "ux_deals_next_source_deal_id"',
    }),
    true,
  );
  assert.equal(
    isUniqueViolation({
      message: "failed query",
      cause: { code: "23505", message: "duplicate key value violates unique constraint" },
    }),
    true,
  );
  assert.equal(
    isUniqueViolation({
      message: "failed query",
      errors: [{ constraint_name: "ux_deals_next_source_deal_id", message: "duplicate key" }],
    }),
    true,
  );
  assert.equal(
    isUniqueViolation({
      code: "25P02",
      message: "current transaction is aborted, commands ignored until end of transaction block",
    }),
    false,
  );
});

test("savepoint rolls back a unique violation and still commits the rest of the transaction", async () => {
  await resetNext();
  await query(SOURCE_DEAL_ID_UNIQUE_SQL);
  await withTransaction(async (q) => {
    await q(
      `INSERT INTO deals_next (deal_number, title, source_deal_id)
       VALUES ('TLY-259', 'Keeper', $1)`,
      [PCB_AXIAL_ID],
    );
    let caught = false;
    try {
      await q.savepoint(async (sp) => {
        await sp(
          `INSERT INTO deals_next (deal_number, title, source_deal_id)
           VALUES ('TLY-286', 'Twin', $1)`,
          [PCB_AXIAL_ID],
        );
      });
    } catch (error) {
      caught = isUniqueViolation(error);
    }
    assert.equal(caught, true);
    await q(
      `INSERT INTO deals_next (deal_number, title, source_deal_id)
       VALUES ('TLY-300', 'CT landscaping add-on', $1)`,
      [LAND_AXIAL_ID],
    );
  });
  const rows = await query<{ deal_number: string; source_deal_id: string }>(
    "SELECT deal_number, source_deal_id FROM deals_next ORDER BY deal_number",
  );
  assert.deepEqual(
    rows.map((r) => r.deal_number),
    ["TLY-259", "TLY-300"],
  );
  assert.equal(rows[0].source_deal_id, PCB_AXIAL_ID);
  assert.equal(rows[1].source_deal_id, LAND_AXIAL_ID);
});
