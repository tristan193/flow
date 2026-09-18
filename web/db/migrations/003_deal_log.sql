-- 003 — Audit log going forward only.
--
-- deal_log is append-only. It records applied changes, rejected agent
-- submissions, and needs_review proposals. Do not backfill old stage/note/
-- verdict/import rows — those were never a complete trail, and copying them
-- would invent history. Current deal state is already on deals_next (002).

CREATE TABLE IF NOT EXISTS deal_log (
  id              BIGSERIAL PRIMARY KEY,
  deal_id         INTEGER,            -- intentionally no FK: log outlives merged rows
  deal_number     TEXT,               -- denormalized so history reads clean forever
  actor           TEXT NOT NULL,      -- from the credential (session member / token), never caller-claimed
  on_behalf_of    TEXT,               -- Dirk executing Tristan's decision records both
  kind            TEXT NOT NULL CHECK (kind IN
                    ('create','update','stage','verdict','cim_verdict','note',
                     'super_like','merge','import','watch')),
  patch           JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { field: { old, new } }
  reason          TEXT,
  source_ref      TEXT,               -- gmail id, CIM file, import detail
  channel         TEXT NOT NULL,      -- 'api:next/cim-intake' | 'ui:swipe'
  status          TEXT NOT NULL DEFAULT 'applied' CHECK (status IN
                    ('applied','rejected','needs_review','confirmed','dismissed')),
  error           TEXT,
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()   -- server clock only
);

CREATE INDEX IF NOT EXISTS ix_deal_log_deal   ON deal_log (deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_deal_log_actor  ON deal_log (actor, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_deal_log_status ON deal_log (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_deal_log_idem
  ON deal_log (actor, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
