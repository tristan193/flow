import { test, before } from "node:test";
import assert from "node:assert/strict";

import { query } from "../db.ts";
import {
  clearNextVerdict,
  listNextBoardDeals,
  listNextInboxDeals,
  moveNextStage,
  setNextSuperLike,
  setNextVerdict,
} from "./deals.ts";
import { byPinnedThenEarnings, byPinnedThenFit } from "./fit.ts";
import { upsertNextDeals } from "./import.ts";
import { applyAuthorizedNextStage } from "./stage-auth.ts";
import type { Fit, FitLevel } from "../fit.ts";

const AXIAL_HTML =
  '<a href="https://network.axial.net/app/opportunity/aaaabbbbccccdddd?action=pursue">Pursue</a>';

function fit(level: FitLevel): Fit {
  return { level } as Fit;
}

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

test("newest Super Like sorts first; unpinned keep byFit order", () => {
  const older = {
    id: 1,
    earnings: 2_000_000,
    super_liked_at: "2026-09-01T10:00:00.000Z",
    fit: fit("priority"),
  };
  const newer = {
    id: 2,
    earnings: 400_000,
    super_liked_at: "2026-09-02T10:00:00.000Z",
    fit: fit("unknown"),
  };
  const unpinnedBetter = {
    id: 3,
    earnings: 900_000,
    super_liked_at: null,
    fit: fit("priority"),
  };
  const unpinnedWorse = {
    id: 4,
    earnings: 100_000,
    super_liked_at: null,
    fit: fit("out"),
  };
  const rows = [unpinnedWorse, older, unpinnedBetter, newer].sort(byPinnedThenFit);
  assert.deepEqual(
    rows.map((row) => row.id),
    [2, 1, 3, 4],
  );
});

test("board columns pin newest Super Like first, then earnings", () => {
  const rows = [
    { id: 1, earnings: 500_000, super_liked_at: null },
    { id: 2, earnings: 100_000, super_liked_at: "2026-09-02T12:00:00.000Z" },
    { id: 3, earnings: 800_000, super_liked_at: "2026-09-02T11:00:00.000Z" },
    { id: 4, earnings: 900_000, super_liked_at: null },
  ].sort(byPinnedThenEarnings);
  assert.deepEqual(
    rows.map((row) => row.id),
    [2, 3, 4, 1],
  );
});

test("Super Like pins and shortlists immediately without writing a verdict", async () => {
  await resetNext();
  await upsertNextDeals([{ title: "Pinned HVAC", html: AXIAL_HTML, ebitda: 800_000 }]);
  const [before] = await listNextInboxDeals();
  assert.equal(before.stage, "inbox");
  assert.equal(before.super_liked_at, null);

  const at = await setNextSuperLike(before.id, true, "partner");
  assert.ok(at);

  assert.equal((await listNextInboxDeals()).length, 0);
  const board = await listNextBoardDeals();
  assert.equal(board[0].title, "Pinned HVAC");
  assert.equal(board[0].stage, "shortlist");
  assert.equal(board[0].super_liked_at, at);
  assert.deepEqual(board[0].verdicts, {});
  assert.equal(board[0].stage_changed_by, "partner");
});

test("multiple Super Likes: newest sits first on Shortlisted", async () => {
  await resetNext();
  await upsertNextDeals([
    { title: "Older pin", html: AXIAL_HTML, ebitda: 1_200_000 },
    {
      title: "Newer pin",
      html: '<a href="https://network.axial.net/app/opportunity/bbbbccccddddeeee?action=pursue">Pursue</a>',
      ebitda: 400_000,
    },
    {
      title: "Unpinned better fit",
      html: '<a href="https://network.axial.net/app/opportunity/ccccddddeeeeffff?action=pursue">Pursue</a>',
      ebitda: 2_000_000,
    },
  ]);
  const inbox = await listNextInboxDeals();
  const older = inbox.find((row) => row.title === "Older pin");
  const newer = inbox.find((row) => row.title === "Newer pin");
  assert.ok(older && newer);

  await setNextSuperLike(older.id, true);
  await new Promise((resolve) => setTimeout(resolve, 15));
  await setNextSuperLike(newer.id, true);

  const remaining = await listNextInboxDeals();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].title, "Unpinned better fit");

  const shortlisted = (await listNextBoardDeals()).filter((row) => row.stage === "shortlist");
  assert.equal(shortlisted[0].title, "Newer pin");
  assert.equal(shortlisted[1].title, "Older pin");
});

test("pin follows a Dirk stage move and stays at the top of the new stack", async () => {
  await resetNext();
  await upsertNextDeals([
    { title: "Pinned to follow", html: AXIAL_HTML, ebitda: 300_000 },
    {
      title: "Already on NDA",
      html: '<a href="https://network.axial.net/app/opportunity/ffffeeeebbbbcccc?action=pursue">Pursue</a>',
      ebitda: 1_500_000,
      proposedStage: "nda",
    },
  ]);
  const inbox = await listNextInboxDeals();
  const pinned = inbox.find((row) => row.title === "Pinned to follow");
  assert.ok(pinned);
  await setNextSuperLike(pinned.id, true);

  const moved = await applyAuthorizedNextStage({
    authorization: null,
    sessionMember: "tristan",
    dealId: pinned.id,
    stage: "nda",
  });
  assert.equal(moved.ok, true);

  const board = await listNextBoardDeals();
  const nda = board.filter((row) => row.stage === "nda");
  assert.equal(nda[0].title, "Pinned to follow");
  assert.ok(nda[0].super_liked_at);
  assert.equal(nda[1].title, "Already on NDA");
});

test("Pass, Pursue, and Closed clear the Super Like pin", async () => {
  await resetNext();
  await upsertNextDeals([
    { title: "Will pass", html: AXIAL_HTML },
    {
      title: "Will pursue",
      html: '<a href="https://network.axial.net/app/opportunity/bbbbccccddddeeee?action=pursue">Pursue</a>',
    },
    {
      title: "Will close",
      html: '<a href="https://network.axial.net/app/opportunity/ccccddddeeeeffff?action=pursue">Pursue</a>',
    },
    {
      title: "Will discuss",
      html: '<a href="https://network.axial.net/app/opportunity/dddddeeeeffffaaaa?action=pursue">Pursue</a>',
    },
  ]);
  const inbox = await listNextInboxDeals();
  const byTitle = Object.fromEntries(inbox.map((row) => [row.title, row]));

  await setNextSuperLike(byTitle["Will pass"].id, true);
  await setNextSuperLike(byTitle["Will pursue"].id, true);
  await setNextSuperLike(byTitle["Will close"].id, true);
  await setNextSuperLike(byTitle["Will discuss"].id, true);

  await setNextVerdict(byTitle["Will pass"].id, "tristan", "pass", null);
  await setNextVerdict(byTitle["Will pursue"].id, "tristan", "short", null);
  await moveNextStage(byTitle["Will close"].id, "dirk", "closed");
  await setNextVerdict(byTitle["Will discuss"].id, "tristan", "discuss", null);

  const passed = await query<{ super_liked_at: unknown }>(
    "SELECT super_liked_at FROM deals_next WHERE title = 'Will pass'",
  );
  const pursued = await query<{ super_liked_at: unknown }>(
    "SELECT super_liked_at FROM deals_next WHERE title = 'Will pursue'",
  );
  const closed = await query<{ super_liked_at: unknown }>(
    "SELECT super_liked_at FROM deals_next WHERE title = 'Will close'",
  );
  const discussed = await query<{ super_liked_at: unknown }>(
    "SELECT super_liked_at FROM deals_next WHERE title = 'Will discuss'",
  );
  assert.equal(passed[0].super_liked_at, null);
  assert.equal(pursued[0].super_liked_at, null);
  assert.equal(closed[0].super_liked_at, null);
  assert.ok(discussed[0].super_liked_at);

  await clearNextVerdict(byTitle["Will discuss"].id, "tristan");
  const stillPinned = (await listNextBoardDeals()).find((row) => row.title === "Will discuss");
  assert.ok(stillPinned);
  assert.equal(stillPinned.stage, "shortlist");
  assert.ok(stillPinned.super_liked_at);
});
