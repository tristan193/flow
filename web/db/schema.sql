-- Flow App schema (PostgreSQL).
--
-- Runs identically against the embedded Postgres used in local development and
-- the hosted Postgres in production, so there is no dialect gap between the two.
-- Every statement is idempotent: this file is applied on every boot.
--
-- Deal identity: every row gets a durable TLY-NNN on first touch. Imports
-- join on deal_number, then source_deal_id / source_ids, then fingerprint —
-- never on broker name or a single Gmail thread.

CREATE TABLE IF NOT EXISTS deals (
  id                  SERIAL PRIMARY KEY,
  ext_id              TEXT UNIQUE NOT NULL,
  deal_number         TEXT UNIQUE,
  source_deal_id      TEXT,
  source_ids          JSONB NOT NULL DEFAULT '[]'::jsonb,
  alias_names         JSONB NOT NULL DEFAULT '[]'::jsonb,
  gmail_thread_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  broker_firm         TEXT,
  fingerprint         TEXT,
  next_action         TEXT,

  title               TEXT NOT NULL,
  blurb               TEXT,
  -- Attribution triad (aligned with pipeline Listing):
  --   source     = sender domain        (bizbuysell.com)
  --   sub_source = sender email         (bizalert@bizbuysell.com)
  --   nickname   = human-facing label   (BizBuySell)
  -- sources (plural) = GROUP_CONCAT of provider domains seen for this deal
  source              TEXT,
  sub_source          TEXT,
  nickname            TEXT,
  sources             TEXT,

  city                TEXT,
  state               TEXT,
  county              TEXT,

  -- Two earnings columns, never collapsed. ebitda is populated only when the
  -- source actually said EBITDA; anything ambiguous ("Cash Flow", bare
  -- "Profit", owner benefit) files as sde. Collapsing them would overstate
  -- businesses whose figures include owner compensation.
  revenue             DOUBLE PRECISION,
  ebitda              DOUBLE PRECISION,
  sde                 DOUBLE PRECISION,
  asking              DOUBLE PRECISION,

  business_model_type TEXT NOT NULL DEFAULT '',
  needs_llm           JSONB NOT NULL DEFAULT '[]'::jsonb,
  url                 TEXT,

  first_seen          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen           TIMESTAMPTZ NOT NULL DEFAULT now(),
  times_seen          INTEGER NOT NULL DEFAULT 1,

  stage               TEXT NOT NULL DEFAULT 'inbox',
  stage_changed_at    TIMESTAMPTZ,
  stage_changed_by    TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_deals_state ON deals (state);
CREATE INDEX IF NOT EXISTS ix_deals_stage ON deals (stage);
CREATE INDEX IF NOT EXISTS ix_deals_last_seen ON deals (last_seen DESC);
CREATE INDEX IF NOT EXISTS ix_deals_fingerprint ON deals (fingerprint);
CREATE INDEX IF NOT EXISTS ix_deals_source_deal_id ON deals (source_deal_id);

CREATE TABLE IF NOT EXISTS deal_counters (
  key     TEXT PRIMARY KEY,
  next_n  INTEGER NOT NULL DEFAULT 1
);
INSERT INTO deal_counters (key, next_n) VALUES ('tly', 1) ON CONFLICT (key) DO NOTHING;

-- Existing hosted DBs were created before the attribution triad — add columns.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS deal_number TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS source_deal_id TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS source_ids JSONB;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS alias_names JSONB;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS gmail_thread_ids JSONB;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS broker_firm TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS fingerprint TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS next_action TEXT;
UPDATE deals SET source_ids = '[]'::jsonb WHERE source_ids IS NULL;
UPDATE deals SET alias_names = '[]'::jsonb WHERE alias_names IS NULL;
UPDATE deals SET gmail_thread_ids = '[]'::jsonb WHERE gmail_thread_ids IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_deals_deal_number ON deals (deal_number) WHERE deal_number IS NOT NULL;

-- Per-member triage. Disagreement is preserved rather than averaged into a
-- consensus neither partner holds, so the primary key is (deal, member) and
-- there is deliberately no single "the verdict" column on deals.
CREATE TABLE IF NOT EXISTS verdicts (
  deal_id     INTEGER NOT NULL REFERENCES deals (id) ON DELETE CASCADE,
  member      TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('short', 'pass', 'discuss')),
  reason      TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, member)
);

CREATE INDEX IF NOT EXISTS ix_verdicts_member ON verdicts (member);

-- Extraction / parsing feedback. Separate from triage verdicts so flagging a
-- bad listing never overwrites shortlist/pass/discuss. These rows are the
-- training signal for improving ingest later.
-- theme: listing (repertoire) | criteria (buy-box queue)
-- criteria_intent: exclusion_miss | criteria_change | null when listing
CREATE TABLE IF NOT EXISTS train_flags (
  deal_id     INTEGER NOT NULL REFERENCES deals (id) ON DELETE CASCADE,
  member      TEXT NOT NULL,
  theme       TEXT NOT NULL DEFAULT 'listing',
  criteria_intent TEXT,
  reason      TEXT NOT NULL,
  detail      TEXT,
  -- Repertoire inspection (Train AI → format learning). Populated on save.
  format_id   TEXT,
  inspection  JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, member)
);

CREATE INDEX IF NOT EXISTS ix_train_flags_reason ON train_flags (reason);

-- Existing hosted DBs: add columns BEFORE indexes that reference them.
ALTER TABLE train_flags ADD COLUMN IF NOT EXISTS format_id TEXT;
ALTER TABLE train_flags ADD COLUMN IF NOT EXISTS inspection JSONB;
ALTER TABLE train_flags ADD COLUMN IF NOT EXISTS theme TEXT;
ALTER TABLE train_flags ADD COLUMN IF NOT EXISTS criteria_intent TEXT;
UPDATE train_flags SET theme = 'listing' WHERE theme IS NULL;

CREATE INDEX IF NOT EXISTS ix_train_flags_theme ON train_flags (theme);

-- Stage history. The board shows where a deal is now; this is how it got
-- there, which matters when a deal has been sitting at NDA for two months.
CREATE TABLE IF NOT EXISTS stage_events (
  id          SERIAL PRIMARY KEY,
  deal_id     INTEGER NOT NULL REFERENCES deals (id) ON DELETE CASCADE,
  from_stage  TEXT,
  to_stage    TEXT NOT NULL,
  member      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_stage_events_deal ON stage_events (deal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notes (
  id          SERIAL PRIMARY KEY,
  deal_id     INTEGER NOT NULL REFERENCES deals (id) ON DELETE CASCADE,
  member      TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_notes_deal ON notes (deal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS import_runs (
  id                SERIAL PRIMARY KEY,
  source            TEXT NOT NULL,
  detail            TEXT,
  deals_new         INTEGER NOT NULL DEFAULT 0,
  deals_updated     INTEGER NOT NULL DEFAULT 0,
  verdicts_applied  INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Drive is an append-only folder whose connector cannot overwrite or delete,
-- so the same snapshot file stays there forever. Recording what has already
-- been ingested is what keeps a re-sync from re-importing the whole history.
CREATE TABLE IF NOT EXISTS drive_files_seen (
  file_id     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  rows_seen   INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reports read earnings through this view, which prefers EBITDA and flags when
-- the figure is really SDE. Keeping the preference in one place stops each
-- query from re-deciding it.
--
-- DROP + CREATE (not CREATE OR REPLACE): adding deals.source / deals.nickname
-- changes the column list behind d.*, and Postgres refuses OR REPLACE when that
-- would rename view columns in place (42P16: cannot change name of view column
-- "earnings" to "source").
DROP VIEW IF EXISTS v_deals;
CREATE VIEW v_deals AS
SELECT
  d.*,
  COALESCE(d.ebitda, d.sde) AS earnings,
  CASE
    WHEN d.ebitda IS NOT NULL THEN 'EBITDA'
    WHEN d.sde    IS NOT NULL THEN 'SDE'
    ELSE NULL
  END AS earnings_basis,
  (d.ebitda IS NULL AND d.sde IS NOT NULL) AS earnings_is_sde,
  -- Cast back to a float: numeric would arrive in JavaScript as a string,
  -- which silently turns arithmetic into string concatenation.
  CASE
    WHEN d.revenue > 0
      THEN ROUND((COALESCE(d.ebitda, d.sde) / d.revenue)::numeric, 4)::float8
    ELSE NULL
  END AS margin
FROM deals d;

-- Latest CIM link (Drive / URL paste). Updated by outreach debrief.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS cim_url TEXT;

-- Pursuit lane: NDA sign URL and Gmail thread deep link (human signs; app links).
ALTER TABLE deals ADD COLUMN IF NOT EXISTS nda_url TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS gmail_thread_url TEXT;

-- Post-shortlist debrief: what happened after Open on Axial (or other playbook).
-- Prompting actions, not a status CRM — chips + optional note/CIM link.
CREATE TABLE IF NOT EXISTS outreach_events (
  id          SERIAL PRIMARY KEY,
  deal_id     INTEGER NOT NULL REFERENCES deals (id) ON DELETE CASCADE,
  member      TEXT NOT NULL,
  outcomes    JSONB NOT NULL DEFAULT '[]'::jsonb,
  note        TEXT,
  cim_url     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_outreach_events_deal ON outreach_events (deal_id, created_at DESC);

-- Uploaded CIMs / materials (shared between partners).
CREATE TABLE IF NOT EXISTS deal_files (
  id            SERIAL PRIMARY KEY,
  deal_id       INTEGER NOT NULL REFERENCES deals (id) ON DELETE CASCADE,
  member        TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'cim',
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  bytes         BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_deal_files_deal ON deal_files (deal_id, created_at DESC);

-- Machine-ingested pursuit signals (NDA available, CIM attached, etc.).
-- Deduped on gmail_message_id so re-harvest is safe.
CREATE TABLE IF NOT EXISTS crm_events (
  id                SERIAL PRIMARY KEY,
  gmail_message_id  TEXT UNIQUE NOT NULL,
  gmail_thread_id   TEXT,
  deal_id           INTEGER REFERENCES deals (id) ON DELETE SET NULL,
  event_type        TEXT NOT NULL,
  subject           TEXT,
  from_address      TEXT,
  nda_url           TEXT,
  gmail_thread_url  TEXT,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'applied',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_crm_events_deal ON crm_events (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_crm_events_type ON crm_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_crm_events_status ON crm_events (status, created_at DESC);

-- Armed watches: shortlist alone is not enough — Act/debrief opens an expectation
-- that inbox pursuit mail should fulfill (NDA / CIM / broker reply).
CREATE TABLE IF NOT EXISTS deal_expectations (
  id              SERIAL PRIMARY KEY,
  deal_id         INTEGER NOT NULL REFERENCES deals (id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open',
  armed_by        TEXT NOT NULL,
  armed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at          TIMESTAMPTZ,
  fulfilled_at    TIMESTAMPTZ,
  crm_event_id    INTEGER REFERENCES crm_events (id) ON DELETE SET NULL,
  note            TEXT
);

CREATE INDEX IF NOT EXISTS ix_deal_expectations_open
  ON deal_expectations (status, kind, due_at)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS ix_deal_expectations_deal
  ON deal_expectations (deal_id, status, armed_at DESC);
