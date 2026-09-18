-- 002 — Two-table collapse, part 1: fold child tables into deals_next columns.
--
-- Members are fixed (Tristan; Jim = member id 'partner'), so votes and notes
-- become named columns on the deal row. Watches (next_followups) become a
-- jsonb list. The plural `sources` text column folds into structured
-- source_domains jsonb (NOT into source_ids — those are listing ids that
-- drive duplicate grouping; mixing shared domains in would merge unrelated
-- deals).
--
-- Child tables stay live: Review/Pipeline still read verdicts_next, notes_next,
-- etc. until a later cutover. deal_log is going-forward only (003 creates it empty).
-- Keep the `sources` text column — current import still writes it.

-- v_deals_next selects d.*; it must go away before columns change shape.
DROP VIEW IF EXISTS v_deals_next;

-- Review votes (New swipe): short = Like, discuss = ?, pass = Pass.
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS tristan_verdict TEXT;
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS tristan_verdict_reason TEXT;
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS tristan_verdict_note TEXT;
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS tristan_verdict_at TIMESTAMPTZ;
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS jim_verdict TEXT;
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS jim_verdict_reason TEXT;
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS jim_verdict_note TEXT;
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS jim_verdict_at TIMESTAMPTZ;

-- CIM votes (short = Pursue, discuss = Hold, pass = Pass).
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS tristan_cim_verdict TEXT;
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS tristan_cim_verdict_note TEXT;
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS tristan_cim_verdict_at TIMESTAMPTZ;
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS jim_cim_verdict TEXT;
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS jim_cim_verdict_note TEXT;
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS jim_cim_verdict_at TIMESTAMPTZ;

-- One notes field per member (threads concatenate with dates on backfill).
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS tristan_notes TEXT;
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS jim_notes TEXT;

-- Super Like pin: who, alongside the existing when.
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS super_liked_by TEXT;

-- Armed watches: [{kind, status, armed_by, armed_at, due_at, note}].
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS watches JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Tombstones for merged-away TLY numbers.
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS alias_numbers JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Structured provider domains (from the plural `sources` text column).
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS source_domains JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Web CIM access note (broker landing password hint etc.).
ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS cim_access_note TEXT;

-- ---------------------------------------------------------------------------
-- Backfills (guarded so a re-run never clobbers newer data).
-- ---------------------------------------------------------------------------

UPDATE deals_next d SET
  tristan_verdict        = v.action,
  tristan_verdict_reason = v.reason,
  tristan_verdict_note   = v.note,
  tristan_verdict_at     = v.updated_at
FROM verdicts_next v
WHERE v.deal_id = d.id AND v.member = 'tristan' AND d.tristan_verdict IS NULL;

UPDATE deals_next d SET
  jim_verdict        = v.action,
  jim_verdict_reason = v.reason,
  jim_verdict_note   = v.note,
  jim_verdict_at     = v.updated_at
FROM verdicts_next v
WHERE v.deal_id = d.id AND v.member = 'partner' AND d.jim_verdict IS NULL;

UPDATE deals_next d SET
  tristan_cim_verdict      = v.action,
  tristan_cim_verdict_note = v.note,
  tristan_cim_verdict_at   = v.updated_at
FROM cim_verdicts_next v
WHERE v.deal_id = d.id AND v.member = 'tristan' AND d.tristan_cim_verdict IS NULL;

UPDATE deals_next d SET
  jim_cim_verdict      = v.action,
  jim_cim_verdict_note = v.note,
  jim_cim_verdict_at   = v.updated_at
FROM cim_verdicts_next v
WHERE v.deal_id = d.id AND v.member = 'partner' AND d.jim_cim_verdict IS NULL;

UPDATE deals_next d SET tristan_notes = n.body
FROM (
  SELECT deal_id,
         string_agg(to_char(created_at, 'YYYY-MM-DD') || ' — ' || body, E'\n\n' ORDER BY created_at) AS body
    FROM notes_next
   WHERE member = 'tristan'
   GROUP BY deal_id
) n
WHERE n.deal_id = d.id AND d.tristan_notes IS NULL;

UPDATE deals_next d SET jim_notes = n.body
FROM (
  SELECT deal_id,
         string_agg(to_char(created_at, 'YYYY-MM-DD') || ' — ' || body, E'\n\n' ORDER BY created_at) AS body
    FROM notes_next
   WHERE member = 'partner'
   GROUP BY deal_id
) n
WHERE n.deal_id = d.id AND d.jim_notes IS NULL;

UPDATE deals_next d SET watches = w.arr
FROM (
  SELECT deal_id,
         jsonb_agg(
           jsonb_build_object(
             'kind', kind, 'status', status, 'armed_by', armed_by,
             'armed_at', armed_at, 'due_at', due_at, 'note', note
           )
           ORDER BY armed_at
         ) AS arr
    FROM next_followups
   GROUP BY deal_id
) w
WHERE w.deal_id = d.id AND d.watches = '[]'::jsonb;

UPDATE deals_next SET source_domains = COALESCE(
  (
    SELECT jsonb_agg(DISTINCT btrim(x))
      FROM unnest(string_to_array(sources, ',')) AS x
     WHERE btrim(x) <> ''
  ),
  '[]'::jsonb
)
WHERE sources IS NOT NULL AND btrim(sources) <> '' AND source_domains = '[]'::jsonb;

-- Rebuild the earnings view over the new column set.
CREATE VIEW v_deals_next AS
SELECT
  d.*,
  COALESCE(d.ebitda, d.sde) AS earnings,
  CASE
    WHEN d.ebitda IS NOT NULL THEN 'EBITDA'
    WHEN d.sde    IS NOT NULL THEN 'SDE'
    ELSE NULL
  END AS earnings_basis,
  (d.ebitda IS NULL AND d.sde IS NOT NULL) AS earnings_is_sde
FROM deals_next d;
