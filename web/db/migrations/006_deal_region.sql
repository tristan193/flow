-- 006 — Axial/census region prose alongside city/state (not instead of).
-- Prefer a real City/ST when present. Region-only teasers store the label here.
-- v_deals_next expands d.* at CREATE time, so rebuild after the new column.

ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS region TEXT;

DROP VIEW IF EXISTS v_deals_next;
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
