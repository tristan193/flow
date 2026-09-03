import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { query } from "../db.ts";
import {
  applyAuthorizedCimIntake,
  parseCimIntakeBody,
  parseLocationString,
  parseOptionalCimName,
  parseOptionalGeoField,
  parseTlyFromFileName,
} from "./cim-intake.ts";
import { nextDealHeadline, nextDealSubline } from "./display.ts";
import { listNextCimDeals } from "./deals.ts";
import { applyAuthorizedNextStage } from "./stage-auth.ts";
import { isNextCimReviewCard } from "./model.ts";

const FILE_URL = "https://drive.google.com/file/d/abcFile092/view";
const FOLDER_URL = "https://drive.google.com/drive/folders/0ABYzLaaJ9ebAUk9PVA";
const TOKEN = "test-cim-intake-token";

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

async function insertDeal(
  dealNumber: string,
  title: string,
  extras: {
    stage?: string;
    revenue?: number;
    ebitda?: number;
    asking?: number;
    margin?: number;
    city?: string;
    state?: string;
    county?: string;
  } = {},
) {
  await query(
    `INSERT INTO deals_next (deal_number, title, stage, revenue, ebitda, asking, margin, city, state, county)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      dealNumber,
      title,
      extras.stage ?? "nda",
      extras.revenue ?? null,
      extras.ebitda ?? null,
      extras.asking ?? null,
      extras.margin ?? null,
      extras.city ?? null,
      extras.state ?? null,
      extras.county ?? null,
    ],
  );
}

before(async () => {
  await query("SELECT 1");
});

test("parseTlyFromFileName reads canonical TLY from Simon's upload name", () => {
  assert.equal(parseTlyFromFileName("TLY-092 Project Cactus.pdf"), "TLY-092");
  assert.equal(parseTlyFromFileName("tly-31 Headline.pdf"), "TLY-031");
  assert.equal(parseTlyFromFileName("TLY-7.pdf"), "TLY-007");
  assert.equal(parseTlyFromFileName("TLY-092ProjectCactus.pdf"), "TLY-092");
  assert.equal(parseTlyFromFileName("/tmp/drive/TLY-014 Iron Bull.pdf"), "TLY-014");
  assert.equal(parseTlyFromFileName("Project Cactus TLY-092.pdf"), null);
  assert.equal(parseTlyFromFileName("Headline.pdf"), null);
  assert.equal(parseTlyFromFileName("TLY-.pdf"), null);
  assert.equal(parseTlyFromFileName(""), null);
});

test("parseCimIntakeBody requires filename TLY and Drive file URL; posted dealNumber must match", () => {
  const ok = parseCimIntakeBody({
    fileName: "TLY-092 Project Cactus.pdf",
    cimUrl: "https://drive.google.com/open?id=abcFile092",
    dealNumber: "tly-092",
    ebitda: "920,000",
    margin: 22,
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.dealNumber, "TLY-092");
    assert.equal(ok.cimUrl, FILE_URL);
    assert.deepEqual(ok.patch, { ebitda: 920_000, margin: 0.22 });
  }

  const named = parseCimIntakeBody({
    fileName: "TLY-092 Project Cactus.pdf",
    cimUrl: FILE_URL,
    cimName: "  Project Cactus  ",
  });
  assert.equal(named.ok, true);
  if (named.ok) assert.equal(named.patch.cimName, "Project Cactus");

  const aliasKey = parseCimIntakeBody({
    fileName: "TLY-014 Iron Bull.pdf",
    cimUrl: FILE_URL,
    companyName: "Iron Bull",
  });
  assert.equal(aliasKey.ok, true);
  if (aliasKey.ok) assert.equal(aliasKey.patch.cimName, "Iron Bull");

  const blankName = parseCimIntakeBody({
    fileName: "TLY-092 Project Cactus.pdf",
    cimUrl: FILE_URL,
    cimName: "   ",
  });
  assert.equal(blankName.ok, true);
  if (blankName.ok) assert.equal(blankName.patch.cimName, undefined);

  const noMatch = parseCimIntakeBody({
    fileName: "TLY-092 Project Cactus.pdf",
    cimUrl: FILE_URL,
    dealNumber: "TLY-031",
  });
  assert.equal(noMatch.ok, false);
  if (!noMatch.ok) assert.match(noMatch.error, /does not match/i);

  const badName = parseCimIntakeBody({
    fileName: "Project Cactus.pdf",
    cimUrl: FILE_URL,
  });
  assert.equal(badName.ok, false);

  const folder = parseCimIntakeBody({
    fileName: "TLY-092 Project Cactus.pdf",
    cimUrl: FOLDER_URL,
  });
  assert.equal(folder.ok, false);

  const missingFile = parseCimIntakeBody({ cimUrl: FILE_URL });
  assert.equal(missingFile.ok, false);
});

test("parseOptionalCimName trims, omits blanks, rejects oversized names", () => {
  assert.deepEqual(parseOptionalCimName(undefined), { ok: true });
  assert.deepEqual(parseOptionalCimName(""), { ok: true });
  assert.deepEqual(parseOptionalCimName("  Cora Constructors  "), { ok: true, value: "Cora Constructors" });
  const long = parseOptionalCimName("x".repeat(241));
  assert.equal(long.ok, false);
});

test("parseOptionalGeoField trims, uppercases 2-letter state, omits blanks", () => {
  assert.deepEqual(parseOptionalGeoField(undefined, "city"), { ok: true });
  assert.deepEqual(parseOptionalGeoField("  Austin  ", "city"), { ok: true, value: "Austin" });
  assert.deepEqual(parseOptionalGeoField("tx", "state"), { ok: true, value: "TX" });
  assert.deepEqual(parseOptionalGeoField("Bermuda", "state"), { ok: true, value: "Bermuda" });
  assert.deepEqual(parseOptionalGeoField("   ", "city"), { ok: true });
  const long = parseOptionalGeoField("x".repeat(81), "city");
  assert.equal(long.ok, false);
});

test("parseLocationString is best-effort and does not invent geo", () => {
  assert.deepEqual(parseLocationString("Austin, TX"), { city: "Austin", state: "TX" });
  assert.deepEqual(parseLocationString("Austin, tx"), { city: "Austin", state: "TX" });
  assert.deepEqual(parseLocationString("Hamilton, Bermuda"), { city: "Hamilton", state: "Bermuda" });
  assert.deepEqual(parseLocationString("Austin TX"), { city: "Austin", state: "TX" });
  assert.deepEqual(parseLocationString("TX"), { state: "TX" });
  assert.deepEqual(parseLocationString("Travis County, TX"), { county: "Travis", state: "TX" });
  assert.deepEqual(parseLocationString("Austin, Travis County, TX"), { city: "Austin", state: "TX" });
  assert.deepEqual(parseLocationString(""), {});
  assert.deepEqual(parseLocationString("Available in a location near you"), {});
  assert.deepEqual(parseLocationString("somewhere"), {});
  assert.deepEqual(parseLocationString("123 Main St, Austin"), {});
});

test("parseCimIntakeBody accepts city/state and fills gaps from location or country", () => {
  const explicit = parseCimIntakeBody({
    fileName: "TLY-092 Project Cactus.pdf",
    cimUrl: FILE_URL,
    city: "Austin",
    state: "TX",
  });
  assert.equal(explicit.ok, true);
  if (explicit.ok) assert.deepEqual({ city: explicit.patch.city, state: explicit.patch.state }, { city: "Austin", state: "TX" });

  const aliases = parseCimIntakeBody({
    fileName: "TLY-092 Project Cactus.pdf",
    cimUrl: FILE_URL,
    City: "Austin",
    region: "tx",
  });
  assert.equal(aliases.ok, true);
  if (aliases.ok) assert.deepEqual({ city: aliases.patch.city, state: aliases.patch.state }, { city: "Austin", state: "TX" });

  const fromLocation = parseCimIntakeBody({
    fileName: "TLY-092 Project Cactus.pdf",
    cimUrl: FILE_URL,
    location: "Austin, TX",
  });
  assert.equal(fromLocation.ok, true);
  if (fromLocation.ok) {
    assert.equal(fromLocation.patch.city, "Austin");
    assert.equal(fromLocation.patch.state, "TX");
  }

  const explicitWins = parseCimIntakeBody({
    fileName: "TLY-092 Project Cactus.pdf",
    cimUrl: FILE_URL,
    city: "Hamilton",
    location: "Austin, TX",
  });
  assert.equal(explicitWins.ok, true);
  if (explicitWins.ok) {
    assert.equal(explicitWins.patch.city, "Hamilton");
    assert.equal(explicitWins.patch.state, "TX");
  }

  const foreign = parseCimIntakeBody({
    fileName: "TLY-092 Project Cactus.pdf",
    cimUrl: FILE_URL,
    city: "Hamilton",
    country: "Bermuda",
  });
  assert.equal(foreign.ok, true);
  if (foreign.ok) {
    assert.equal(foreign.patch.city, "Hamilton");
    assert.equal(foreign.patch.state, "Bermuda");
  }

  const countryIgnoredWhenStatePresent = parseCimIntakeBody({
    fileName: "TLY-092 Project Cactus.pdf",
    cimUrl: FILE_URL,
    city: "Austin",
    state: "TX",
    country: "Bermuda",
  });
  assert.equal(countryIgnoredWhenStatePresent.ok, true);
  if (countryIgnoredWhenStatePresent.ok) {
    assert.equal(countryIgnoredWhenStatePresent.patch.state, "TX");
  }

  const omitted = parseCimIntakeBody({
    fileName: "TLY-092 Project Cactus.pdf",
    cimUrl: FILE_URL,
  });
  assert.equal(omitted.ok, true);
  if (omitted.ok) {
    assert.equal(omitted.patch.city, undefined);
    assert.equal(omitted.patch.state, undefined);
    assert.equal(omitted.patch.county, undefined);
  }
});

test("token required; session or missing token cannot intake", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = TOKEN;
  try {
    await insertDeal("TLY-092", "Project Cactus");

    const noToken = await applyAuthorizedCimIntake({
      authorization: null,
      fileName: "TLY-092 Project Cactus.pdf",
      cimUrl: FILE_URL,
    });
    assert.equal(noToken.ok, false);
    if (!noToken.ok) assert.equal(noToken.status, 401);

    const wrong = await applyAuthorizedCimIntake({
      authorization: "Bearer other-token",
      fileName: "TLY-092 Project Cactus.pdf",
      cimUrl: FILE_URL,
    });
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.equal(wrong.status, 401);
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("unknown TLY and dealNumber mismatch fail cleanly and do not insert", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = TOKEN;
  try {
    await insertDeal("TLY-031", "Iron Bull", { stage: "nda", revenue: 1_000_000 });

    const unknown = await applyAuthorizedCimIntake({
      authorization: `Bearer ${TOKEN}`,
      fileName: "TLY-092 Project Cactus.pdf",
      cimUrl: FILE_URL,
      revenue: 4_200_000,
    });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.status, 404);

    const mismatch = await applyAuthorizedCimIntake({
      authorization: `Bearer ${TOKEN}`,
      fileName: "TLY-092 Project Cactus.pdf",
      dealNumber: "TLY-031",
      cimUrl: FILE_URL,
    });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.status, 400);

    const rows = await query<{ deal_number: string; stage: string; cim_url: string | null; revenue: number }>(
      "SELECT deal_number, stage, cim_url, revenue FROM deals_next ORDER BY deal_number",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].deal_number, "TLY-031");
    assert.equal(rows[0].stage, "nda");
    assert.equal(rows[0].cim_url, null);
    assert.equal(Number(rows[0].revenue), 1_000_000);

    const verdicts = await query("SELECT 1 FROM cim_verdicts_next");
    assert.equal(verdicts.length, 0);
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("partial financials preserve existing fields; URL + financials + stage update atomically", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = TOKEN;
  try {
    await insertDeal("TLY-092", "Project Cactus", {
      stage: "nda",
      revenue: 1_000_000,
      ebitda: 200_000,
    });
    await insertDeal("TLY-014", "Project Cactus", { stage: "shortlist", revenue: 9 });

    const countBefore = await query<{ n: string }>("SELECT count(*)::text AS n FROM deals_next");

    const stamped = await applyAuthorizedCimIntake({
      authorization: `Bearer ${TOKEN}`,
      fileName: "TLY-092 Project Cactus.pdf",
      cimUrl: "https://drive.google.com/open?id=abcFile092",
      asking: 6_500_000,
      margin: 22,
    });
    assert.equal(stamped.ok, true);
    if (stamped.ok) {
      assert.equal(stamped.dealNumber, "TLY-092");
      assert.equal(stamped.stage, "cim");
      assert.equal(stamped.cimUrl, FILE_URL);
      assert.equal(stamped.revenue, 1_000_000);
      assert.equal(stamped.ebitda, 200_000);
      assert.equal(stamped.margin, 0.22);
      assert.equal(stamped.asking, 6_500_000);
      assert.equal(stamped.deal.deal_number, "TLY-092");
      assert.equal(stamped.deal.stage, "cim");
      assert.equal(stamped.deal.cim_url, FILE_URL);
      assert.notEqual(stamped.deal.next_action, "Await CIM / data room");
      assert.deepEqual(stamped.deal.cim_verdicts, {});
    }

    const countAfter = await query<{ n: string }>("SELECT count(*)::text AS n FROM deals_next");
    assert.equal(countAfter[0].n, countBefore[0].n);

    const row = await query<{
      stage: string;
      cim_url: string;
      revenue: number;
      ebitda: number;
      asking: number;
      margin: number;
    }>("SELECT stage, cim_url, revenue, ebitda, asking, margin FROM deals_next WHERE deal_number = 'TLY-092'");
    assert.equal(row[0].stage, "cim");
    assert.equal(row[0].cim_url, FILE_URL);
    assert.equal(Number(row[0].revenue), 1_000_000);
    assert.equal(Number(row[0].ebitda), 200_000);
    assert.equal(Number(row[0].asking), 6_500_000);
    assert.equal(Number(row[0].margin), 0.22);

    const decoy = await query<{ stage: string; cim_url: string | null }>(
      "SELECT stage, cim_url FROM deals_next WHERE deal_number = 'TLY-014'",
    );
    assert.equal(decoy[0].stage, "shortlist");
    assert.equal(decoy[0].cim_url, null);

    const votes = await query("SELECT 1 FROM cim_verdicts_next");
    assert.equal(votes.length, 0);
    const inboxVotes = await query("SELECT 1 FROM verdicts_next");
    assert.equal(inboxVotes.length, 0);
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("CIM deck reads the same canonical row after intake and after stage transition", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = TOKEN;
  try {
    await insertDeal("TLY-092", "Project Cactus", { stage: "nda" });
    await insertDeal("TLY-001", "Water Infrastructure", { stage: "shortlist" });

    const before = await listNextCimDeals();
    assert.equal(
      before.some((deal) => deal.deal_number === "TLY-092"),
      false,
    );

    const intake = await applyAuthorizedCimIntake({
      authorization: `Bearer ${TOKEN}`,
      fileName: "TLY-092 Project Cactus.pdf",
      cimUrl: FILE_URL,
      revenue: 4_200_000,
    });
    assert.equal(intake.ok, true);

    const afterIntake = await listNextCimDeals();
    const cactus = afterIntake.find((deal) => deal.deal_number === "TLY-092");
    assert.ok(cactus);
    assert.equal(cactus.stage, "cim");
    assert.equal(cactus.cim_url, FILE_URL);
    assert.equal(cactus.revenue, 4_200_000);
    assert.equal(cactus.id, intake.ok ? intake.deal.id : -1);

    const moved = await applyAuthorizedNextStage({
      authorization: `Bearer ${TOKEN}`,
      sessionMember: null,
      dealNumber: "TLY-001",
      stage: "cim",
    });
    assert.equal(moved.ok, true);

    const afterStage = await listNextCimDeals();
    const numbers = afterStage.map((deal) => deal.deal_number).sort();
    assert.deepEqual(numbers, ["TLY-001", "TLY-092"]);
    assert.equal(isNextCimReviewCard({ stage: "cim", cim_url: null }), true);
    assert.equal(
      afterStage.every((deal) => deal.cim_verdicts && !("simon" in deal.cim_verdicts)),
      true,
    );
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("cim_name column exists on deals_next", async () => {
  const cols = await query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_name = 'deals_next' AND column_name = 'cim_name'`,
  );
  assert.equal(cols.length, 1);
});

test("intake with cimName writes cim_name, keeps teaser title, and does not insert a row", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = TOKEN;
  try {
    await insertDeal("TLY-092", "Specialty HVAC — Austin metro", { stage: "nda" });
    await insertDeal("TLY-014", "Unrelated decoy", { stage: "shortlist" });
    const countBefore = await query<{ n: string }>("SELECT count(*)::text AS n FROM deals_next");

    const stamped = await applyAuthorizedCimIntake({
      authorization: `Bearer ${TOKEN}`,
      fileName: "TLY-092 Project Cactus.pdf",
      cimUrl: FILE_URL,
      cimName: "Project Cactus",
    });
    assert.equal(stamped.ok, true);
    if (stamped.ok) {
      assert.equal(stamped.cimName, "Project Cactus");
      assert.equal(stamped.deal.title, "Specialty HVAC — Austin metro");
      assert.equal(stamped.deal.cim_name, "Project Cactus");
      assert.equal(nextDealHeadline(stamped.deal), "Project Cactus");
      assert.equal(nextDealSubline(stamped.deal), "Specialty HVAC — Austin metro");
    }

    const countAfter = await query<{ n: string }>("SELECT count(*)::text AS n FROM deals_next");
    assert.equal(countAfter[0].n, countBefore[0].n);
    assert.equal(countAfter[0].n, "2");

    const row = await query<{
      title: string;
      cim_name: string | null;
      alias_names: unknown;
      stage: string;
    }>("SELECT title, cim_name, alias_names, stage FROM deals_next WHERE deal_number = 'TLY-092'");
    assert.equal(row[0].title, "Specialty HVAC — Austin metro");
    assert.equal(row[0].cim_name, "Project Cactus");
    assert.equal(row[0].stage, "cim");
    const aliases = Array.isArray(row[0].alias_names)
      ? row[0].alias_names.map(String)
      : JSON.parse(String(row[0].alias_names));
    assert.equal(
      aliases.some((name: string) => /specialty hvac/i.test(name)),
      true,
    );
    assert.equal(
      aliases.some((name: string) => /project cactus/i.test(name)),
      true,
    );

    const decoy = await query<{ title: string; cim_name: string | null; stage: string }>(
      "SELECT title, cim_name, stage FROM deals_next WHERE deal_number = 'TLY-014'",
    );
    assert.equal(decoy[0].title, "Unrelated decoy");
    assert.equal(decoy[0].cim_name, null);
    assert.equal(decoy[0].stage, "shortlist");

    const votes = await query("SELECT 1 FROM cim_verdicts_next");
    assert.equal(votes.length, 0);
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("intake without cimName leaves title and cim_name alone", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = TOKEN;
  try {
    await insertDeal("TLY-092", "Specialty HVAC — Austin metro", { stage: "nda" });

    const stamped = await applyAuthorizedCimIntake({
      authorization: `Bearer ${TOKEN}`,
      fileName: "TLY-092 Headline.pdf",
      cimUrl: FILE_URL,
    });
    assert.equal(stamped.ok, true);
    if (stamped.ok) {
      assert.equal(stamped.cimName, null);
      assert.equal(stamped.deal.title, "Specialty HVAC — Austin metro");
      assert.equal(stamped.deal.cim_name, null);
      assert.equal(nextDealHeadline(stamped.deal), "Specialty HVAC — Austin metro");
      assert.equal(nextDealSubline(stamped.deal), null);
    }

    const blank = await applyAuthorizedCimIntake({
      authorization: `Bearer ${TOKEN}`,
      fileName: "TLY-092 Headline.pdf",
      cimUrl: FILE_URL,
      cimName: "   ",
    });
    assert.equal(blank.ok, true);
    if (blank.ok) {
      assert.equal(blank.deal.title, "Specialty HVAC — Austin metro");
      assert.equal(blank.deal.cim_name, null);
    }

    const rows = await query<{ n: string }>("SELECT count(*)::text AS n FROM deals_next");
    assert.equal(rows[0].n, "1");
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("intake with city/state overwrites geo; omitted geo leaves existing city/state alone", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = TOKEN;
  try {
    await insertDeal("TLY-092", "Kar-Tainer", {
      stage: "nda",
      city: "Hamilton",
      state: "Bermuda",
    });

    const omitted = await applyAuthorizedCimIntake({
      authorization: `Bearer ${TOKEN}`,
      fileName: "TLY-092 Kar-Tainer.pdf",
      cimUrl: FILE_URL,
      cimName: "Kar-Tainer",
    });
    assert.equal(omitted.ok, true);
    if (omitted.ok) {
      assert.equal(omitted.city, "Hamilton");
      assert.equal(omitted.state, "Bermuda");
      assert.equal(omitted.deal.city, "Hamilton");
      assert.equal(omitted.deal.state, "Bermuda");
    }

    const blank = await applyAuthorizedCimIntake({
      authorization: `Bearer ${TOKEN}`,
      fileName: "TLY-092 Kar-Tainer.pdf",
      cimUrl: FILE_URL,
      city: "   ",
      state: "",
    });
    assert.equal(blank.ok, true);
    if (blank.ok) {
      assert.equal(blank.city, "Hamilton");
      assert.equal(blank.state, "Bermuda");
    }

    const overwritten = await applyAuthorizedCimIntake({
      authorization: `Bearer ${TOKEN}`,
      fileName: "TLY-092 Kar-Tainer.pdf",
      cimUrl: FILE_URL,
      city: "Austin",
      state: "TX",
    });
    assert.equal(overwritten.ok, true);
    if (overwritten.ok) {
      assert.equal(overwritten.city, "Austin");
      assert.equal(overwritten.state, "TX");
      assert.equal(overwritten.deal.city, "Austin");
      assert.equal(overwritten.deal.state, "TX");
      assert.equal(overwritten.cimName, "Kar-Tainer");
    }

    const row = await query<{ city: string; state: string; county: string | null; cim_name: string }>(
      "SELECT city, state, county, cim_name FROM deals_next WHERE deal_number = 'TLY-092'",
    );
    assert.equal(row[0].city, "Austin");
    assert.equal(row[0].state, "TX");
    assert.equal(row[0].county, null);
    assert.equal(row[0].cim_name, "Kar-Tainer");

    const fromLocation = await applyAuthorizedCimIntake({
      authorization: `Bearer ${TOKEN}`,
      fileName: "TLY-092 Kar-Tainer.pdf",
      cimUrl: FILE_URL,
      location: "Hamilton, Bermuda",
    });
    assert.equal(fromLocation.ok, true);
    if (fromLocation.ok) {
      assert.equal(fromLocation.city, "Hamilton");
      assert.equal(fromLocation.state, "Bermuda");
    }

    const fromCountry = await applyAuthorizedCimIntake({
      authorization: `Bearer ${TOKEN}`,
      fileName: "TLY-092 Kar-Tainer.pdf",
      cimUrl: FILE_URL,
      city: "Hamilton",
      country: "Bermuda",
    });
    assert.equal(fromCountry.ok, true);
    if (fromCountry.ok) {
      assert.equal(fromCountry.city, "Hamilton");
      assert.equal(fromCountry.state, "Bermuda");
    }
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("intake on a closed deal stamps the pack but does not reopen the card", async () => {
  await resetNext();
  const previous = process.env.FLOW_IMPORT_TOKEN;
  process.env.FLOW_IMPORT_TOKEN = TOKEN;
  try {
    await insertDeal("TLY-031", "Iron Bull", { stage: "closed" });
    const stamped = await applyAuthorizedCimIntake({
      authorization: `Bearer ${TOKEN}`,
      fileName: "TLY-031 Iron Bull.pdf",
      cimUrl: FILE_URL,
    });
    assert.equal(stamped.ok, true);
    if (stamped.ok) {
      assert.equal(stamped.stage, "closed");
      assert.equal(stamped.cimUrl, FILE_URL);
    }
    const row = await query<{ stage: string; cim_url: string }>(
      "SELECT stage, cim_url FROM deals_next WHERE deal_number = 'TLY-031'",
    );
    assert.equal(row[0].stage, "closed");
    assert.equal(row[0].cim_url, FILE_URL);
  } finally {
    if (previous == null) delete process.env.FLOW_IMPORT_TOKEN;
    else process.env.FLOW_IMPORT_TOKEN = previous;
  }
});

test("CIM intake route is token-only, middleware-allowlisted, and does not create deals or call Google", () => {
  const route = readFileSync(path.join(process.cwd(), "app/api/next/cim-intake/route.ts"), "utf8");
  const auth = readFileSync(path.join(process.cwd(), "lib/next/cim-intake.ts"), "utf8");
  const middleware = readFileSync(path.join(process.cwd(), "middleware.ts"), "utf8");
  const client = readFileSync(path.join(process.cwd(), "components/next/cim-review-client.tsx"), "utf8");
  const card = readFileSync(path.join(process.cwd(), "components/next/deal-card.tsx"), "utf8");
  const cli = readFileSync(path.join(process.cwd(), "..", "pipeline", "cim_intake.py"), "utf8");

  assert.match(route, /FLOW_IMPORT_TOKEN/);
  assert.match(route, /applyAuthorizedCimIntake/);
  assert.match(middleware, /\/api\/next\/cim-intake/);
  assert.match(auth, /withTransaction/);
  assert.match(auth, /Never inserts a deal or a vote/);
  assert.doesNotMatch(auth, /googleapis|GOOGLE_SERVICE_ACCOUNT|files\.create/);
  assert.doesNotMatch(route, /googleapis|GOOGLE_SERVICE_ACCOUNT/);
  assert.doesNotMatch(auth, /INSERT INTO deals_next/);
  assert.doesNotMatch(auth, /INSERT INTO (cim_)?verdicts_next/);
  assert.doesNotMatch(auth, /normalizeTeaserName|title-string|fuzzy title/);
  assert.match(client, /View CIM/);
  assert.match(client, /CimNewTabLink/);
  assert.match(client, /SuperLikeStar/);
  assert.match(client, /CimPackMetrics/);
  assert.doesNotMatch(client, /Written review|Simon/);
  assert.match(cli, /FLOW_IMPORT_TOKEN/);
  assert.match(cli, /\/api\/next\/cim-intake/);
  assert.match(cli, /--cim-name/);
  assert.match(cli, /cimName/);
  assert.doesNotMatch(cli, /googleapis|files\.create/);
  assert.match(cli, /Never print the token/);
  assert.match(auth, /cim_name = COALESCE/);
  assert.match(auth, /cimName/);
  assert.doesNotMatch(auth, /SET title =/);
  assert.match(card, /nextDealHeadline/);
  assert.match(card, /nextDealSubline/);
  assert.match(route, /cimName/);
  assert.match(route, /"city"/);
  assert.match(route, /"state"/);
  assert.match(route, /country/);
  assert.match(auth, /city = COALESCE/);
  assert.match(auth, /state = COALESCE/);
  assert.match(cli, /--city/);
  assert.match(cli, /--state/);
  assert.match(cli, /--country/);
  assert.match(auth, /no country column|No country column|no deals_next.country/i);
});
