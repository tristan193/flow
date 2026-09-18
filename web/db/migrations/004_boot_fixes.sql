-- 004 — One-off data fixes that used to re-run on every boot (lib/boot.ts).
-- Axial Pass→Pursue URL swap on the legacy deals table. The Gmail thread URL
-- rewrite is not replayed here: the read path normalizes those links.

UPDATE deals
   SET url = regexp_replace(
         regexp_replace(url, 'action=decline', 'action=pursue', 'gi'),
         'utm_content=pass', 'utm_content=pursue', 'gi'
       ),
       updated_at = now()
 WHERE url ILIKE '%axial.net%'
   AND (url ILIKE '%action=decline%' OR url ILIKE '%utm_content=pass%');
