import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { query } from "../db.ts";
import { applyAuthorizedClearCimVerdicts } from "./cim-verdicts-auth.ts";
import { applyAuthorizedNextStage } from "./stage-auth.ts";

const TOKEN = "test-dirk-cim-verdicts";

async function resetNext() {
  await query(`
    TRUNCATE TABLE
      deal_log,
      deals_next,
      next_deal_counters
    RESTART IDENTITY CASCADE
  `);
  await query(`INSERT INTO next_deal_counters (key, next_n) VALUES ('tly', 1)`);
}

async function insertDualPursue(dealNumber: string, title: string) {
  await query(
    `INSERT INTO deals_next (
       deal_number, title, stage,
       tristan_verdict, jim_verdict,
       tristan_cim_verdict, tristan_cim_verdict_note, tristan_cim_verdict_at,
       jim_cim_verdict, jim_cim_verdict_note, jim_cim_verdict_at
     ) VALUES (
       $1, $2, 'pursuing',
       'short', 'pass',
       'short', 'pursue pack', now(),
       'short', 'agree', now()
     )`,
    [dealNumber, title],
  );
}

before(async () => {
  await query("SELECT 1");
});

test("clear nulls both CIM votes, leaves stage and Review votes, and a later CIM move sticks", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = TOKEN;
  try {
    await insertDualPursue("TLY-168", "Project Rectifier");
    await insertDualPursue("TLY-169", "Still bouncing");

    const noToken = await applyAuthorizedClearCimVerdicts({
      authorization: null,
      dealNumber: "TLY-168",
      mode: "clear",
    });
    assert.equal(noToken.ok, false);
    if (!noToken.ok) assert.equal(noToken.status, 401);

    const badMode = await applyAuthorizedClearCimVerdicts({
      authorization: `Bearer ${TOKEN}`,
      dealNumber: "TLY-168",
      mode: "pursue",
    });
    assert.equal(badMode.ok, false);
    if (!badMode.ok) assert.equal(badMode.status, 400);

    const missingIdentity = await applyAuthorizedClearCimVerdicts({
      authorization: `Bearer ${TOKEN}`,
      mode: "clear",
    });
    assert.equal(missingIdentity.ok, false);
    if (!missingIdentity.ok) assert.equal(missingIdentity.status, 400);

    const badNumber = await applyAuthorizedClearCimVerdicts({
      authorization: `Bearer ${TOKEN}`,
      dealNumber: "not-a-deal",
      mode: "clear",
    });
    assert.equal(badNumber.ok, false);
    if (!badNumber.ok) assert.equal(badNumber.status, 400);

    const missing = await applyAuthorizedClearCimVerdicts({
      authorization: `Bearer ${TOKEN}`,
      dealNumber: "TLY-999",
      mode: "clear",
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 404);

    const cleared = await applyAuthorizedClearCimVerdicts({
      authorization: `Bearer ${TOKEN}`,
      dealNumber: "tly-168",
      mode: "clear",
    });
    assert.equal(cleared.ok, true);
    if (cleared.ok) {
      assert.equal(cleared.dealNumber, "TLY-168");
      assert.equal(cleared.stage, "pursuing");
      assert.deepEqual(cleared.cleared, ["tristan", "jim"]);
    }

    const row = await query<{
      stage: string;
      tristan_verdict: string | null;
      jim_verdict: string | null;
      tristan_cim_verdict: string | null;
      tristan_cim_verdict_note: string | null;
      tristan_cim_verdict_at: string | null;
      jim_cim_verdict: string | null;
      jim_cim_verdict_note: string | null;
      jim_cim_verdict_at: string | null;
    }>(
      `SELECT stage,
              tristan_verdict, jim_verdict,
              tristan_cim_verdict, tristan_cim_verdict_note, tristan_cim_verdict_at,
              jim_cim_verdict, jim_cim_verdict_note, jim_cim_verdict_at
         FROM deals_next WHERE deal_number = 'TLY-168'`,
    );
    assert.equal(row[0].stage, "pursuing");
    assert.equal(row[0].tristan_verdict, "short");
    assert.equal(row[0].jim_verdict, "pass");
    assert.equal(row[0].tristan_cim_verdict, null);
    assert.equal(row[0].tristan_cim_verdict_note, null);
    assert.equal(row[0].tristan_cim_verdict_at, null);
    assert.equal(row[0].jim_cim_verdict, null);
    assert.equal(row[0].jim_cim_verdict_note, null);
    assert.equal(row[0].jim_cim_verdict_at, null);

    const logs = await query<{ actor: string; on_behalf_of: string | null; channel: string; kind: string }>(
      `SELECT actor, on_behalf_of, channel, kind
         FROM deal_log
        WHERE deal_number = 'TLY-168' AND kind = 'cim_verdict'
        ORDER BY id`,
    );
    assert.equal(logs.length, 2);
    assert.deepEqual(
      logs.map((entry) => entry.actor),
      ["dirk", "dirk"],
    );
    assert.deepEqual(
      logs.map((entry) => entry.on_behalf_of).sort(),
      ["partner", "tristan"],
    );
    assert.equal(logs.every((entry) => entry.channel === "api:next/cim-verdicts"), true);

    const again = await applyAuthorizedClearCimVerdicts({
      authorization: `Bearer ${TOKEN}`,
      dealNumber: "TLY-168",
      mode: "clear",
    });
    assert.equal(again.ok, true);
    if (again.ok) assert.deepEqual(again.cleared, []);

    const stayed = await applyAuthorizedNextStage({
      authorization: `Bearer ${TOKEN}`,
      sessionMember: null,
      dealNumber: "TLY-168",
      stage: "cim",
    });
    assert.equal(stayed.ok, true);
    if (stayed.ok) assert.equal(stayed.stage, "cim");
    const afterMove = await query<{ stage: string }>(
      "SELECT stage FROM deals_next WHERE deal_number = 'TLY-168'",
    );
    assert.equal(afterMove[0].stage, "cim");

    const bounced = await applyAuthorizedNextStage({
      authorization: `Bearer ${TOKEN}`,
      sessionMember: null,
      dealNumber: "TLY-169",
      stage: "cim",
    });
    assert.equal(bounced.ok, true);
    const stillPursuing = await query<{
      stage: string;
      tristan_cim_verdict: string | null;
      jim_cim_verdict: string | null;
    }>(
      "SELECT stage, tristan_cim_verdict, jim_cim_verdict FROM deals_next WHERE deal_number = 'TLY-169'",
    );
    assert.equal(stillPursuing[0].stage, "pursuing");
    assert.equal(stillPursuing[0].tristan_cim_verdict, "short");
    assert.equal(stillPursuing[0].jim_cim_verdict, "short");
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("clear accepts dealId and only reports votes that were set", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = TOKEN;
  try {
    await query(
      `INSERT INTO deals_next (
         deal_number, title, stage, jim_cim_verdict, jim_cim_verdict_note, jim_cim_verdict_at
       ) VALUES ('TLY-170', 'Jim only', 'cim', 'pass', 'no', now())`,
    );
    const [row] = await query<{ id: number }>("SELECT id FROM deals_next WHERE deal_number = 'TLY-170'");
    const cleared = await applyAuthorizedClearCimVerdicts({
      authorization: `Bearer ${TOKEN}`,
      dealId: String(row.id),
      mode: "clear",
    });
    assert.equal(cleared.ok, true);
    if (cleared.ok) {
      assert.equal(cleared.dealId, Number(row.id));
      assert.equal(cleared.stage, "cim");
      assert.deepEqual(cleared.cleared, ["jim"]);
    }
    const after = await query<{
      stage: string;
      tristan_cim_verdict: string | null;
      jim_cim_verdict: string | null;
      jim_cim_verdict_note: string | null;
    }>(
      `SELECT stage, tristan_cim_verdict, jim_cim_verdict, jim_cim_verdict_note
         FROM deals_next WHERE deal_number = 'TLY-170'`,
    );
    assert.equal(after[0].stage, "cim");
    assert.equal(after[0].tristan_cim_verdict, null);
    assert.equal(after[0].jim_cim_verdict, null);
    assert.equal(after[0].jim_cim_verdict_note, null);
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("cim-verdicts route is token-only and allowlisted", () => {
  const route = readFileSync(path.join(process.cwd(), "app/api/next/cim-verdicts/route.ts"), "utf8");
  const auth = readFileSync(path.join(process.cwd(), "lib/next/cim-verdicts-auth.ts"), "utf8");
  const middleware = readFileSync(path.join(process.cwd(), "middleware.ts"), "utf8");
  assert.match(route, /FLOW_IMPORT_TOKEN/);
  assert.match(route, /applyAuthorizedClearCimVerdicts/);
  assert.doesNotMatch(route, /currentMember|requireMember|moveNextStage/);
  assert.match(auth, /resolveMachineActor/);
  assert.match(auth, /clearNextCimVerdict/);
  assert.doesNotMatch(auth, /moveNextStage|setNextCimVerdict/);
  assert.match(middleware, /\/api\/next\/cim-verdicts/);
});
