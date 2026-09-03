import { test, before } from "node:test";
import assert from "node:assert/strict";

import { query } from "../db.ts";
import {
  cimFolderTitle,
  dealNumberFromFolderName,
  indexCimFolders,
  isLegacySimonCimDeal,
} from "./cim-drive.ts";
import {
  ensureCimFolderForDeal,
  resolveCimDriveLinks,
  setCimFolderCreatorForTests,
} from "./cim-drive-sync.ts";
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
  setNextSuperLike,
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

test("Dirk folder title is TLY-XXX Headline; slashes flatten", () => {
  assert.equal(cimFolderTitle("TLY-014", "Foo / Bar"), "TLY-014 Foo Bar");
  assert.equal(cimFolderTitle("tly-014", "  HVAC\\Midwest  "), "TLY-014 HVAC Midwest");
  assert.equal(cimFolderTitle("TLY-003", ""), "TLY-003");
});

test("auto-match is only for the three Simon-named packs", () => {
  assert.equal(isLegacySimonCimDeal("TLY-007"), true);
  assert.equal(isLegacySimonCimDeal("tly-031"), true);
  assert.equal(isLegacySimonCimDeal("TLY-092"), true);
  assert.equal(isLegacySimonCimDeal("TLY-014"), false);
  assert.equal(isLegacySimonCimDeal("TLY-100"), false);
});

test("resolveCimDriveLinks ignores non-legacy deal numbers", async () => {
  const result = await resolveCimDriveLinks(["TLY-100"]);
  assert.deepEqual(result, { scanned: 0, matched: 0, written: 0 });
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
    if (reviewed.ok) {
      assert.equal(reviewed.actor, "simon");
      assert.equal(reviewed.viewUrl, drive);
    }

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

test("Dirk creates the CIM folder and stores viewUrl; does not recreate", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = "test-cim-token";
  const created: Array<{ title: string; parentId: string }> = [];
  setCimFolderCreatorForTests(async ({ title, parentId }) => {
    created.push({ title, parentId });
    return { id: `created-${created.length}` };
  });
  try {
    await upsertNextDeals([{ title: "Foo / Bar", html: AXIAL_HTML }]);
    const [row] = await query<{ id: number; deal_number: string }>(
      "SELECT id, deal_number FROM deals_next",
    );
    assert.equal(cimFolderTitle(row.deal_number, "Foo / Bar"), `${row.deal_number} Foo Bar`);

    const first = await ensureCimFolderForDeal(row.id);
    assert.equal(first.ok, true);
    assert.equal(first.created, true);
    assert.equal(first.matched, false);
    assert.equal(first.folderId, "created-1");
    assert.equal(first.viewUrl, "https://drive.google.com/drive/folders/created-1");
    assert.equal(first.folderTitle, `${row.deal_number} Foo Bar`);
    assert.equal(created.length, 1);
    assert.equal(created[0]?.title, `${row.deal_number} Foo Bar`);
    assert.equal(created[0]?.parentId, "0ABYzLaaJ9ebAUk9PVA");

    const deal = await getNextDeal(row.id);
    assert.equal(deal?.cim_url, first.viewUrl);

    const second = await ensureCimFolderForDeal(row.id);
    assert.equal(second.ok, true);
    assert.equal(second.created, false);
    assert.equal(second.folderId, "created-1");
    assert.equal(created.length, 1);

    const toCim = await applyAuthorizedNextStage({
      authorization: "Bearer test-cim-token",
      sessionMember: null,
      dealNumber: row.deal_number,
      stage: "cim",
    });
    assert.equal(toCim.ok, true);
    if (toCim.ok) {
      assert.equal(toCim.viewUrl, first.viewUrl);
    }
    assert.equal(created.length, 1);
  } finally {
    setCimFolderCreatorForTests(null);
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("Shortlist creates the Drive folder; CIM does not", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = "test-cim-token";
  let creates = 0;
  setCimFolderCreatorForTests(async () => {
    creates += 1;
    return { id: "shortFolder", viewUrl: "https://drive.google.com/drive/folders/shortFolder" };
  });
  try {
    await upsertNextDeals([{ title: "Needs a pack", html: AXIAL_HTML }]);
    const [row] = await query<{ id: number; deal_number: string }>(
      "SELECT id, deal_number FROM deals_next",
    );
    const shortlisted = await applyAuthorizedNextStage({
      authorization: "Bearer test-cim-token",
      sessionMember: null,
      dealNumber: row.deal_number,
      stage: "shortlist",
    });
    assert.equal(shortlisted.ok, true);
    if (shortlisted.ok) {
      assert.equal(shortlisted.viewUrl, "https://drive.google.com/drive/folders/shortFolder");
    }
    assert.equal(creates, 1);
    const afterShort = await getNextDeal(row.id);
    assert.equal(afterShort?.stage, "shortlist");
    assert.equal(afterShort?.cim_url, "https://drive.google.com/drive/folders/shortFolder");

    const toCim = await applyAuthorizedNextStage({
      authorization: "Bearer test-cim-token",
      sessionMember: null,
      dealNumber: row.deal_number,
      stage: "cim",
    });
    assert.equal(toCim.ok, true);
    if (toCim.ok) {
      assert.equal(toCim.viewUrl, "https://drive.google.com/drive/folders/shortFolder");
    }
    assert.equal(creates, 1);
    const afterCim = await getNextDeal(row.id);
    assert.equal(afterCim?.stage, "cim");
    assert.equal(afterCim?.cim_url, "https://drive.google.com/drive/folders/shortFolder");
  } finally {
    setCimFolderCreatorForTests(null);
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("Like and Super Like create the folder on Shortlist, not later", async () => {
  await resetNext();
  let creates = 0;
  setCimFolderCreatorForTests(async () => {
    creates += 1;
    return { id: `like-${creates}` };
  });
  try {
    await upsertNextDeals([
      { title: "Liked inbound", html: AXIAL_HTML },
      {
        title: "Super liked inbound",
        html: '<a href="https://network.axial.net/app/opportunity/bbbbccccddddeeee?action=pursue">Pursue</a>',
      },
    ]);
    const liked = await query<{ id: number }>(
      "SELECT id FROM deals_next WHERE title = 'Liked inbound'",
    );
    const superLiked = await query<{ id: number }>(
      "SELECT id FROM deals_next WHERE title = 'Super liked inbound'",
    );

    await setNextVerdict(liked[0].id, "tristan", "short", null);
    const afterLike = await getNextDeal(liked[0].id);
    assert.equal(afterLike?.stage, "shortlist");
    assert.equal(afterLike?.cim_url, "https://drive.google.com/drive/folders/like-1");
    assert.equal(creates, 1);

    await setNextSuperLike(superLiked[0].id, true, "tristan");
    const afterSuper = await getNextDeal(superLiked[0].id);
    assert.equal(afterSuper?.stage, "shortlist");
    assert.equal(afterSuper?.cim_url, "https://drive.google.com/drive/folders/like-2");
    assert.equal(creates, 2);
  } finally {
    setCimFolderCreatorForTests(null);
  }
});

test("moving straight to CIM does not create a folder", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = "test-cim-token";
  let creates = 0;
  setCimFolderCreatorForTests(async () => {
    creates += 1;
    return { id: "should-not-create" };
  });
  try {
    await upsertNextDeals([{ title: "Skip to CIM", html: AXIAL_HTML }]);
    const [row] = await query<{ id: number; deal_number: string }>(
      "SELECT id, deal_number FROM deals_next",
    );
    const moved = await applyAuthorizedNextStage({
      authorization: "Bearer test-cim-token",
      sessionMember: null,
      dealNumber: row.deal_number,
      stage: "cim",
    });
    assert.equal(moved.ok, true);
    assert.equal(creates, 0);
    const deal = await getNextDeal(row.id);
    assert.equal(deal?.stage, "cim");
    assert.equal(deal?.cim_url, null);
  } finally {
    setCimFolderCreatorForTests(null);
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});
