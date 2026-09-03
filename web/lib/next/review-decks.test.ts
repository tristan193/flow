import { test, before } from "node:test";
import assert from "node:assert/strict";

import { query } from "../db.ts";
import {
  listNextBoardDeals,
  listNextInboxDeals,
  setNextSuperLike,
  setNextVerdict,
} from "./deals.ts";
import { upsertNextDeals } from "./import.ts";
import { nextInboxDeck } from "./model.ts";

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

async function seedInbox(title = "Parallel HVAC") {
  await upsertNextDeals([{ title, html: AXIAL_HTML, ebitda: 600_000 }]);
  const [deal] = await listNextInboxDeals();
  assert.ok(deal);
  return deal;
}

before(async () => {
  await query("SELECT 1");
});

test("Tristan Pass leaves the card in Jim's inbound deck", async () => {
  await resetNext();
  const deal = await seedInbox();

  await setNextVerdict(deal.id, "tristan", "pass", null);

  const inbox = await listNextInboxDeals();
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].stage, "inbox");
  assert.equal(inbox[0].verdicts.tristan?.action, "pass");
  assert.equal(inbox[0].verdicts.partner, undefined);
  assert.deepEqual(
    nextInboxDeck(inbox, "tristan").map((row) => row.id),
    [],
  );
  assert.deepEqual(
    nextInboxDeck(inbox, "partner").map((row) => row.id),
    [deal.id],
  );
});

test("either Like shortlists immediately and leaves both decks", async () => {
  await resetNext();
  const deal = await seedInbox("Like wins");

  await setNextVerdict(deal.id, "partner", "short", null);

  assert.equal((await listNextInboxDeals()).length, 0);
  const board = await listNextBoardDeals();
  assert.equal(board[0].id, deal.id);
  assert.equal(board[0].stage, "shortlist");
});

test("either Super Like shortlists immediately and keeps the pin", async () => {
  await resetNext();
  const deal = await seedInbox("Super Like wins");

  const at = await setNextSuperLike(deal.id, true, "tristan");
  assert.ok(at);

  assert.equal((await listNextInboxDeals()).length, 0);
  const board = await listNextBoardDeals();
  assert.equal(board[0].id, deal.id);
  assert.equal(board[0].stage, "shortlist");
  assert.equal(board[0].super_liked_at, at);
  assert.deepEqual(board[0].verdicts, {});
});

test("both Discuss (?) shortlists", async () => {
  await resetNext();
  const deal = await seedInbox("Both unsure");

  await setNextVerdict(deal.id, "tristan", "discuss", null);
  assert.equal((await listNextInboxDeals())[0].stage, "inbox");

  await setNextVerdict(deal.id, "partner", "discuss", null);
  assert.equal((await listNextInboxDeals()).length, 0);
  const board = await listNextBoardDeals();
  assert.equal(board[0].id, deal.id);
  assert.equal(board[0].stage, "shortlist");
});

test("both Pass archives to Closed", async () => {
  await resetNext();
  const deal = await seedInbox("Walked");

  await setNextVerdict(deal.id, "tristan", "pass", "Too small");
  assert.equal((await listNextInboxDeals())[0].stage, "inbox");

  await setNextVerdict(deal.id, "partner", "pass", "Wrong industry");
  assert.equal((await listNextInboxDeals()).length, 0);
  const board = await listNextBoardDeals();
  assert.equal(board[0].id, deal.id);
  assert.equal(board[0].stage, "closed");
});

test("Pass + Discuss archives once both have voted", async () => {
  await resetNext();
  const deal = await seedInbox("Split walk");

  await setNextVerdict(deal.id, "partner", "discuss", null);
  const afterJim = await listNextInboxDeals();
  assert.equal(afterJim[0].stage, "inbox");
  assert.deepEqual(
    nextInboxDeck(afterJim, "tristan").map((row) => row.id),
    [deal.id],
  );

  await setNextVerdict(deal.id, "tristan", "pass", null);
  assert.equal((await listNextInboxDeals()).length, 0);
  const board = await listNextBoardDeals();
  assert.equal(board[0].stage, "closed");
});

test("Jim Like after Tristan Pass still shortlists", async () => {
  await resetNext();
  const deal = await seedInbox("Saved by Jim");

  await setNextVerdict(deal.id, "tristan", "pass", null);
  await setNextVerdict(deal.id, "partner", "short", null);

  assert.equal((await listNextInboxDeals()).length, 0);
  const board = await listNextBoardDeals();
  assert.equal(board[0].id, deal.id);
  assert.equal(board[0].stage, "shortlist");
});
