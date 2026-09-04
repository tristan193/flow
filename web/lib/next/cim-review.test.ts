import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { query } from "../db.ts";
import {
  addNextNote,
  getNextDeal,
  listNextCimDeals,
  listNextInboxDeals,
  listNextNotesForDeals,
  setNextCimVerdict,
  setNextVerdict,
} from "./deals.ts";
import {
  cimNoteSectionLabel,
  cimPartnerNoteFields,
  cimStagePartnerNotes,
} from "./model.ts";
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
  const holdDeck = await listNextCimDeals();
  assert.equal(
    nextCimDeck(holdDeck, "tristan").some((deal) => deal.id === row.id),
    true,
  );

  await setNextCimVerdict(row.id, "partner", "short");
  const both = await getNextDeal(row.id);
  assert.equal(both?.stage, "pursuing");
  const afterAgree = await listNextCimDeals();
  assert.equal(
    nextCimDeck(afterAgree, "tristan").some((deal) => deal.id === row.id),
    false,
  );
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
  assert.match(client, /CimNewTabLink/);
  assert.match(client, /href=\{packHref\}/);
  assert.match(client, /cimPackPath/);
  assert.doesNotMatch(client, /googleapis|files\.create|GOOGLE_SERVICE_ACCOUNT/);
  assert.doesNotMatch(page, /googleapis|resolveCimDriveLinks|GOOGLE_SERVICE_ACCOUNT/);
  assert.doesNotMatch(verdict, /googleapis|GOOGLE_SERVICE_ACCOUNT/);
  assert.match(page, /listNextCimDeals/);
  assert.doesNotMatch(review, /Browse everything in List view/);
  assert.doesNotMatch(review, /setMode|"swipe" \| "list"/);
  assert.match(review, /FitStrip/);
  assert.match(client, /CimPartnerNotes/);
  assert.match(client, /dealId=\{top\.id\}/);
  assert.match(client, /member=\{member\}/);
  assert.match(client, /notes are not votes/);
  assert.match(client, /Hung jury/);
  assert.doesNotMatch(client, /\/api\/next\/notes/);
  assert.doesNotMatch(client, /FitStrip/);
  assert.doesNotMatch(client, /No financials|no earnings/);
  assert.match(client, /SuperLikeStar/);
  assert.match(client, /CimPackMetrics/);
  assert.doesNotMatch(client, /Written review/);
  assert.match(page, /listNextNotesForDeals/);
  assert.match(page, /partnerNotesOnly/);
  assert.match(page, /notesByDealId/);
  assert.doesNotMatch(review, /CimPartnerNotes/);
});

test("stored notes_next: CIM cards see Tristan/Jim only; NDA cards see none", async () => {
  await resetNext();
  await upsertNextDeals([{ title: "At CIM", html: AXIAL_HTML, stage: "cim" }]);
  await upsertNextDeals([
    {
      title: "Still NDA",
      html: '<a href="https://network.axial.net/app/opportunity/bbbbccccddddeeee?action=pursue">Pursue</a>',
      stage: "nda",
    },
  ]);
  const cim = await query<{ id: number }>("SELECT id FROM deals_next WHERE title = 'At CIM'");
  const nda = await query<{ id: number }>("SELECT id FROM deals_next WHERE title = 'Still NDA'");
  await query(`INSERT INTO notes_next (deal_id, member, body) VALUES
    ($1, 'tristan', 'like the pack'),
    ($1, 'partner', 'hold for margin'),
    ($1, 'simon', 'specialist writeup'),
    ($2, 'tristan', 'early nda thought')`, [cim[0].id, nda[0].id]);

  const map = await listNextNotesForDeals([cim[0].id, nda[0].id]);
  const cimShown = cimStagePartnerNotes({ stage: "cim" }, map.get(cim[0].id));
  const ndaShown = cimStagePartnerNotes({ stage: "nda" }, map.get(nda[0].id));
  assert.deepEqual(
    cimShown.map((note) => note.member).sort(),
    ["partner", "tristan"],
  );
  assert.equal(
    cimShown.some((note) => /specialist/i.test(note.body)),
    false,
  );
  assert.deepEqual(ndaShown, []);

  const emptyFields = cimPartnerNoteFields({ stage: "cim" }, []);
  assert.ok(emptyFields);
  assert.deepEqual(
    emptyFields.map((field) => field.label),
    [cimNoteSectionLabel("tristan"), cimNoteSectionLabel("partner")],
  );
  const cimFields = cimPartnerNoteFields({ stage: "cim" }, map.get(cim[0].id));
  assert.ok(cimFields);
  assert.equal(cimFields[0].notes.some((note) => note.body === "like the pack"), true);
  assert.equal(cimFields[1].notes.some((note) => note.body === "hold for margin"), true);
  assert.equal(
    cimFields.some((field) => field.notes.some((note) => /specialist/i.test(note.body))),
    false,
  );
  assert.equal(cimPartnerNoteFields({ stage: "nda" }, map.get(nda[0].id)), null);
});

test("notes save path writes notes_next and CIM fields stay labeled", async () => {
  await resetNext();
  await upsertNextDeals([{ title: "B'Safe pack", html: AXIAL_HTML, stage: "cim" }]);
  const [row] = await query<{ id: number }>("SELECT id FROM deals_next WHERE title = $1", [
    "B'Safe pack",
  ]);
  await addNextNote(row.id, "tristan", "pack looks solid");
  await addNextNote(row.id, "simon", "specialist writeup");

  const map = await listNextNotesForDeals([row.id]);
  const fields = cimPartnerNoteFields({ stage: "cim" }, map.get(row.id));
  assert.ok(fields);
  assert.deepEqual(
    fields.map((field) => field.label),
    [cimNoteSectionLabel("tristan"), cimNoteSectionLabel("partner")],
  );
  assert.deepEqual(
    fields[0].notes.map((note) => note.body),
    ["pack looks solid"],
  );
  assert.deepEqual(fields[1].notes, []);
  assert.equal(
    fields.some((field) => field.notes.some((note) => /specialist/i.test(note.body))),
    false,
  );
});

test("saving Tristan or Jim notes is not a CIM determination", async () => {
  await resetNext();
  await upsertNextDeals([{ title: "Note only", html: AXIAL_HTML, stage: "cim" }]);
  await upsertNextDeals([
    {
      title: "Also waiting",
      html: '<a href="https://network.axial.net/app/opportunity/bbbbccccddddeeee?action=pursue">Pursue</a>',
      stage: "cim",
    },
  ]);
  const [noted] = await query<{ id: number }>("SELECT id FROM deals_next WHERE title = $1", [
    "Note only",
  ]);
  const [other] = await query<{ id: number }>("SELECT id FROM deals_next WHERE title = $1", [
    "Also waiting",
  ]);
  const eventsBefore = await query("SELECT 1 FROM stage_events_next WHERE deal_id = $1", [
    noted.id,
  ]);

  await addNextNote(noted.id, "tristan", "like the pack");
  await addNextNote(noted.id, "partner", "hold for margin");

  const afterNotes = await getNextDeal(noted.id);
  assert.equal(afterNotes?.stage, "cim");
  assert.deepEqual(afterNotes?.cim_verdicts, {});
  const votes = await query("SELECT 1 FROM cim_verdicts_next WHERE deal_id = $1", [noted.id]);
  assert.equal(votes.length, 0);
  const eventsAfter = await query("SELECT 1 FROM stage_events_next WHERE deal_id = $1", [
    noted.id,
  ]);
  assert.equal(eventsAfter.length, eventsBefore.length);

  const cim = await listNextCimDeals();
  assert.deepEqual(
    nextCimDeck(cim, "tristan").map((deal) => deal.id).sort((a, b) => a - b),
    [noted.id, other.id].sort((a, b) => a - b),
  );
  assert.deepEqual(
    nextCimDeck(cim, "partner").map((deal) => deal.id).sort((a, b) => a - b),
    [noted.id, other.id].sort((a, b) => a - b),
  );

  await setNextCimVerdict(noted.id, "tristan", "short");
  const oneVote = await getNextDeal(noted.id);
  assert.equal(oneVote?.stage, "cim");
  const stillThere = await listNextCimDeals();
  assert.equal(
    nextCimDeck(stillThere, "tristan").some((deal) => deal.id === noted.id),
    true,
  );
  assert.equal(
    nextCimDeck(stillThere, "partner").some((deal) => deal.id === noted.id),
    true,
  );
});

test("hung jury stays at CIM and sorts to the bottom of the stack", async () => {
  await resetNext();
  await upsertNextDeals([{ title: "Open pack", html: AXIAL_HTML, stage: "cim" }]);
  await upsertNextDeals([
    {
      title: "Hung pack",
      html: '<a href="https://network.axial.net/app/opportunity/bbbbccccddddeeee?action=pursue">Pursue</a>',
      stage: "cim",
    },
  ]);
  const [open] = await query<{ id: number }>("SELECT id FROM deals_next WHERE title = $1", [
    "Open pack",
  ]);
  const [hung] = await query<{ id: number }>("SELECT id FROM deals_next WHERE title = $1", [
    "Hung pack",
  ]);

  await setNextCimVerdict(hung.id, "tristan", "short");
  await setNextCimVerdict(hung.id, "partner", "pass");
  const after = await getNextDeal(hung.id);
  assert.equal(after?.stage, "cim");

  const cim = await listNextCimDeals();
  const tristanDeck = nextCimDeck(cim, "tristan").map((deal) => deal.id);
  const partnerDeck = nextCimDeck(cim, "partner").map((deal) => deal.id);
  assert.deepEqual(tristanDeck, [open.id, hung.id]);
  assert.deepEqual(partnerDeck, [open.id, hung.id]);
  assert.equal(tristanDeck[tristanDeck.length - 1], hung.id);
});

test("CIM-stage cards show partner notes; earlier stages and Simon stay hidden", () => {
  const notesUi = readFileSync(path.join(process.cwd(), "components/next/notes.tsx"), "utf8");
  const board = readFileSync(path.join(process.cwd(), "components/next/pipeline-board.tsx"), "utf8");
  const pipeline = readFileSync(path.join(process.cwd(), "app/next/pipeline/page.tsx"), "utf8");
  const detail = readFileSync(path.join(process.cwd(), "app/next/deals/[id]/page.tsx"), "utf8");
  const model = readFileSync(path.join(process.cwd(), "lib/next/model.ts"), "utf8");
  const notesApi = readFileSync(path.join(process.cwd(), "app/api/next/notes/route.ts"), "utf8");

  assert.match(notesUi, /cimPartnerNoteFields/);
  assert.match(notesUi, /CimPartnerNotes/);
  assert.match(notesUi, /\/api\/next\/notes/);
  assert.match(notesUi, /None yet/);
  assert.doesNotMatch(notesUi, /visible\.length === 0/);
  assert.doesNotMatch(notesUi, /member === ["']simon["']/);
  assert.match(board, /CimPartnerNotes/);
  assert.match(board, /dealId=\{deal\.id\}/);
  assert.match(pipeline, /listNextNotesForDeals/);
  assert.match(pipeline, /partnerNotesOnly/);
  assert.match(detail, /CimPartnerNotes/);
  assert.match(detail, /isCimStageForNotes/);
  assert.match(detail, /partnerNotesOnly/);
  assert.match(model, /coerceNextStage\(deal\.stage\) === "cim"/);
  assert.match(notesApi, /addNextNote/);
  assert.doesNotMatch(notesApi, /setNextCimVerdict|applyNextCimOutcome|moveNextStage/);
  assert.doesNotMatch(notesUi, /\/api\/next\/cim\/verdict/);
  assert.doesNotMatch(notesUi, /setNextCimVerdict/);
});
