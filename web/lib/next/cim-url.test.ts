import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveStoredCim } from "../cim-open.ts";
import { query } from "../db.ts";
import { applyAuthorizedCimIntake } from "./cim-intake.ts";
import { applyAuthorizedCimUrl } from "./cim-url-auth.ts";
import { getNextDeal } from "./deals.ts";
import { listDirkFollowups } from "./dirk.ts";
import { defaultNextAction } from "./stages.ts";

const FILE_URL = "https://drive.google.com/file/d/abcFile092/view";
const FOLDER_URL = "https://drive.google.com/drive/folders/0ABYzLaaJ9ebAUk9PVA";

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

test("cim_url column exists on deals_next", async () => {
  const cols = await query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_name = 'deals_next' AND column_name = 'cim_url'`,
  );
  assert.equal(cols.length, 1);
});

test("/cim redirects when cimUrl is a Drive file link", async () => {
  await resetNext();
  await query(`INSERT INTO deals_next (deal_number, title, cim_url) VALUES ($1, $2, $3)`, [
    "TLY-092",
    "Project Cactus",
    FILE_URL,
  ]);

  const result = await resolveStoredCim("tly-092");
  assert.deepEqual(result, {
    status: "found",
    dealNumber: "TLY-092",
    viewUrl: FILE_URL,
  });
});

test("missing cimUrl is CIM not in yet, never a Drive-disconnected error", async () => {
  await resetNext();
  await query(`INSERT INTO deals_next (deal_number, title) VALUES ($1, $2)`, [
    "TLY-031",
    "No pack yet",
  ]);

  const missing = await resolveStoredCim("TLY-031");
  assert.deepEqual(missing, { status: "missing", dealNumber: "TLY-031" });

  const unknownDeal = await resolveStoredCim("TLY-999");
  assert.deepEqual(unknownDeal, { status: "missing", dealNumber: "TLY-999" });

  const folderStored = await query(
    `INSERT INTO deals_next (deal_number, title, cim_url) VALUES ($1, $2, $3)`,
    ["TLY-007", "Folder only", FOLDER_URL],
  );
  assert.ok(folderStored);
  const folder = await resolveStoredCim("TLY-007");
  assert.deepEqual(folder, { status: "missing", dealNumber: "TLY-007" });

  assert.deepEqual(await resolveStoredCim("not-a-deal"), { status: "invalid" });
});

test("token can set cimUrl; session or missing token cannot", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = "test-dirk-cim-token";
  try {
    await query(`INSERT INTO deals_next (deal_number, title) VALUES ($1, $2)`, [
      "TLY-092",
      "Project Cactus",
    ]);

    const noToken = await applyAuthorizedCimUrl({
      authorization: null,
      dealNumber: "TLY-092",
      cimUrl: FILE_URL,
    });
    assert.equal(noToken.ok, false);
    if (!noToken.ok) assert.equal(noToken.status, 401);

    const folder = await applyAuthorizedCimUrl({
      authorization: "Bearer test-dirk-cim-token",
      dealNumber: "TLY-092",
      cimUrl: FOLDER_URL,
    });
    assert.equal(folder.ok, false);
    if (!folder.ok) assert.equal(folder.status, 400);

    const missingDeal = await applyAuthorizedCimUrl({
      authorization: "Bearer test-dirk-cim-token",
      dealNumber: "TLY-031",
      cimUrl: FILE_URL,
    });
    assert.equal(missingDeal.ok, false);
    if (!missingDeal.ok) assert.equal(missingDeal.status, 404);

    const stamped = await applyAuthorizedCimUrl({
      authorization: "Bearer test-dirk-cim-token",
      dealNumber: "tly-092",
      cimUrl: "https://drive.google.com/open?id=abcFile092",
    });
    assert.equal(stamped.ok, true);
    if (stamped.ok) {
      assert.equal(stamped.dealNumber, "TLY-092");
      assert.equal(stamped.cimUrl, FILE_URL);
      assert.equal(stamped.stage, "cim");
    }

    const opened = await resolveStoredCim("TLY-092");
    assert.deepEqual(opened, {
      status: "found",
      dealNumber: "TLY-092",
      viewUrl: FILE_URL,
    });
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("cim-url stamp from NDA moves to CIM and drops Await CIM copy; intake still moves to CIM", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = "test-dirk-cim-token";
  try {
    await query(
      `INSERT INTO deals_next (deal_number, title, stage, next_action)
       VALUES ($1, $2, $3, $4)`,
      ["TLY-031", "Iron Bull", "nda", "Await CIM / data room"],
    );
    await query(
      `INSERT INTO deals_next (deal_number, title, stage, next_action)
       VALUES ($1, $2, $3, $4)`,
      ["TLY-092", "Project Cactus", "nda", "Await CIM / data room"],
    );
    await query(
      `INSERT INTO deals_next (deal_number, title, stage, next_action)
       VALUES ($1, $2, $3, $4)`,
      ["TLY-014", "Already walked", "closed", "Await CIM / data room"],
    );
    await query(
      `INSERT INTO next_followups (deal_id, kind, status, armed_by)
       SELECT id, 'cim', 'open', 'dirk' FROM deals_next WHERE deal_number = 'TLY-031'`,
    );

    const stamped = await applyAuthorizedCimUrl({
      authorization: "Bearer test-dirk-cim-token",
      dealNumber: "TLY-031",
      cimUrl: FILE_URL,
    });
    assert.equal(stamped.ok, true);
    if (stamped.ok) {
      assert.equal(stamped.stage, "cim");
      assert.equal(stamped.cimUrl, FILE_URL);
    }

    const iron = await getNextDeal(
      Number(
        (await query<{ id: number }>("SELECT id FROM deals_next WHERE deal_number = 'TLY-031'"))[0]
          .id,
      ),
    );
    assert.ok(iron);
    assert.equal(iron.stage, "cim");
    assert.equal(iron.cim_url, FILE_URL);
    assert.equal(iron.next_action, defaultNextAction("cim"));
    assert.notEqual(iron.next_action, "Await CIM / data room");
    assert.ok(iron.stage_changed_at);
    assert.equal(iron.stage_changed_by, "dirk");

    const followups = await listDirkFollowups();
    const ironFollow = followups.find((row) => row.dealNumber === "TLY-031");
    assert.ok(ironFollow);
    assert.notEqual(ironFollow.nextAction, "Await CIM / data room");
    assert.doesNotMatch(ironFollow.nextAction ?? "", /await\s+cim|data\s*room/i);

    const intake = await applyAuthorizedCimIntake({
      authorization: "Bearer test-dirk-cim-token",
      fileName: "TLY-092 Project Cactus.pdf",
      cimUrl: FILE_URL,
    });
    assert.equal(intake.ok, true);
    if (intake.ok) {
      assert.equal(intake.stage, "cim");
      assert.equal(intake.cimUrl, FILE_URL);
      assert.equal(intake.deal.stage, "cim");
      assert.equal(intake.deal.next_action, defaultNextAction("cim"));
    }

    const closed = await applyAuthorizedCimUrl({
      authorization: "Bearer test-dirk-cim-token",
      dealNumber: "TLY-014",
      cimUrl: FILE_URL,
    });
    assert.equal(closed.ok, true);
    if (closed.ok) assert.equal(closed.stage, "closed");
    const walked = await query<{ stage: string; cim_url: string; next_action: string | null }>(
      "SELECT stage, cim_url, next_action FROM deals_next WHERE deal_number = 'TLY-014'",
    );
    assert.equal(walked[0].stage, "closed");
    assert.equal(walked[0].cim_url, FILE_URL);
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("CIM opener does not import a Google client or require GOOGLE_SERVICE_ACCOUNT_JSON", async () => {
  const prev = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  try {
    await resetNext();
    await query(`INSERT INTO deals_next (deal_number, title, cim_url) VALUES ($1, $2, $3)`, [
      "TLY-092",
      "Project Cactus",
      FILE_URL,
    ]);
    const result = await resolveStoredCim("TLY-092");
    assert.equal(result.status, "found");
    assert.equal(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, undefined);

    const opener = readFileSync(path.join(process.cwd(), "lib/cim-open.ts"), "utf8");
    const page = readFileSync(path.join(process.cwd(), "app/cim/[id]/page.tsx"), "utf8");
    assert.doesNotMatch(opener, /googleapis|GOOGLE_SERVICE_ACCOUNT/);
    assert.doesNotMatch(page, /googleapis|lookupCimPack|Drive is not connected/);
    assert.match(page, /CIM not in yet/);
  } finally {
    if (prev === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = prev;
  }
});
