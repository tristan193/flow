-- 005 — Point crm_events.deal_id at the dealbook.
--
-- Pursuit CRM now stamps deals_next (NDA URL, gmail_thread_ids, stage).
-- Classic deals(id) and deals_next(id) are independent serials, so leftover
-- crm_events.deal_id values must not be reused as next ids. Null them, then
-- retarget the FK. Flush still does not touch deals_next.

UPDATE crm_events SET deal_id = NULL;

ALTER TABLE crm_events DROP CONSTRAINT IF EXISTS crm_events_deal_id_fkey;

ALTER TABLE crm_events
  ADD CONSTRAINT crm_events_deal_id_fkey
  FOREIGN KEY (deal_id) REFERENCES deals_next (id) ON DELETE SET NULL;
