# Flow App API (for agents)

One origin. Not many ports.

```
https://web-tau-seven-77.vercel.app
```

Every call is HTTPS to that host. There is no separate ingest port, CIM port, or Dirk port. Middleware either lets a **bearer token** through or requires a **browser session cookie**. A token POST to a path that is not on the allowlist `307`s to `/login` — that looks like “the API is down.” Check `web/middleware.ts` `PUBLIC_PATHS` first.

Live deals live in `deals_next` (TLY numbers) + `deal_log`. Review, CIM Review, Pipeline, `/db`, harvest `POST /api/import`, and `/api/next/*` are views of that one dataset. Classic leftover tables (`deals`, `verdicts`, …) are not the product path. If you are Dirk or Simon, use `/api/next/*` (harvest still POSTs `/api/import`, which now writes the same dealbook).

---

## Auth

| Who | How |
|-----|-----|
| Dirk / Simon / harvest | `Authorization: Bearer $FLOW_IMPORT_TOKEN` (still works; attributed as Dirk) |
| Preferred | `DIRK_TOKEN` / `SIMON_TOKEN` / `PIPELINE_TOKEN` — `deal_log.actor` is the credential that called |
| Vercel Cron | `Authorization: Bearer $CRON_SECRET` (only `/api/cron/harvest`) |
| Tristan / Jim | Session cookie after `/login` — **agents do not use this** |

Never print the token. Never put it in `FLOW_APP_URL`. JSON bodies, `Content-Type: application/json`, unless a browser upload says otherwise.

```bash
BASE=https://web-tau-seven-77.vercel.app
# FLOW_IMPORT_TOKEN from the environment. Do not echo it.
curl -sS -X POST "$BASE/api/next/cim-intake" \
  -H "Authorization: Bearer $FLOW_IMPORT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cimUrl":"https://drive.google.com/file/d/FILE_ID/view","dealNumber":"TLY-092"}'
```

Python helpers (cwd `pipeline/`): `cim_intake.py`, `export_snapshot.py --post`, `crm_pursuit.py --post`.

---

## Which endpoints you should touch

**Machine (token).** These are the agent surface.

| Method | Path | Who | Writes |
|--------|------|-----|--------|
| POST | `/api/next/import` | Dirk / Harve | `deals_next` + `deal_log` (mint or join TLY) |
| GET | `/api/next/dirk` | Dirk | none (poll) |
| GET | `/api/next/stats` | Dirk | none (counts) |
| POST | `/api/next/stage` | Dirk | stage on an existing TLY + `deal_log` |
| POST | `/api/next/cim-intake` | **Simon** | pack URL on existing TLY + `deal_log` |
| POST | `/api/next/cim-url` | Dirk | pack URL only + stage CIM + `deal_log` |
| POST | `/api/next/cim-financials` | Dirk / Simon | pack numbers only; **no stage**; + `deal_log` |
| POST | `/api/next/merge` | Dirk / ops | collapse duplicate TLY rows + `deal_log` |
| POST | `/api/next/gmail-threads` | Dirk | replace / prepend / append `gmail_thread_ids` on an existing TLY + `deal_log` |
| POST | `/api/import` | harvest only | `deals_next` (skipIfNew on unmatched catalog older than 4 days) |
| POST | `/api/crm/pursuit` | harvest | NDA / thread attach on classic+Next match |
| GET/POST | `/api/cron/harvest` | Vercel Cron | dispatches GitHub Actions |

**Humans (session).** Review swipe, notes, Train AI, `/db` confirm. Agents **must not** call these. You cannot cast votes.

**Do not call unless Tristan explicitly asked:** `POST /api/import/flush` (`FLUSH` / `PURGE`). Classic leftover `deals` only — it does not empty `deals_next`.

---

## Next ingest — `POST /api/next/import`

Mint or update TLY cards. One JSON POST, `deals` array (one row or many). Dedupe is **per deal**, not per file: TLY number → listing id → fingerprint → name+broker/geo.

Does **not** write the classic `deals` table.

```json
{
  "deals": [
    {
      "title": "HVAC platform — Dallas",
      "source": "axial.net",
      "nickname": "a1b2c3d4e5",
      "url": "https://app.axial.net/...",
      "gmailThreadIds": ["18c..."],
      "sourceIds": [{ "kind": "axial", "value": "a1b2c3d4e5", "canonical": "axial:a1b2c3d4e5" }],
      "city": "Dallas",
      "state": "TX",
      "revenue": 4200000,
      "ebitda": 920000
    }
  ]
}
```

Remint / attach-only (do not mint a Review card):

```json
{
  "deals": [
    {
      "title": "Life-safety follow-up",
      "duplicateOf": "TLY-132",
      "ingestDisposition": "attached",
      "gmailThreadIds": ["18d..."]
    }
  ]
}
```

- `ingestDisposition`: `new` | `attached` | `remint`
- Unknown `duplicateOf` → Closed audit row, never inbox
- `blurb` is notes. Do not put “this is a duplicate of TLY-132” in English and expect the API to parse it
- Optional `verdicts` in the payload are **not applied**. They park as `needs_review` on `/db` if that path is wired; do not send votes

Re-post is safe (upsert). There is no whole-request transaction: if item 12 of 20 throws, 1–11 are already in Neon. Replay the same JSON.

---

## Dirk poll — `GET /api/next/dirk`

```
GET /api/next/dirk
GET /api/next/dirk?section=inbound
GET /api/next/dirk?section=verdicts
GET /api/next/dirk?section=followups
```

Read-only. Use this to see what needs a stage move or a CIM stamp. Do not scrape the Review HTML.

`followups` is the punch-list: live Shortlisted / NDA / CIM / Pursuing first (with `gmailLinks`), then open watches on those stages. Closed / walked / passed / dead watches are excluded and cannot starve the list.

---

## Deal counts — `GET /api/next/stats`

```
GET /api/next/stats
```

Read-only. Same bearer as the Dirk poll. Counts rows in `deals_next` (one row per TLY). Does not return deal bodies.

```json
{
  "ok": true,
  "totalTly": 0,
  "austinTx": 0,
  "byStage": { "inbox": 0 }
}
```

`austinTx` is city or region `ILIKE '%austin%'`, and state null or `ILIKE '%tx%'` / `'%texas%'`. `byStage` maps each stored stage to its row count.

---

## Stage — `POST /api/next/stage`

```json
{ "dealNumber": "TLY-002", "stage": "nda" }
```

Canonical stages: `inbox` | `shortlist` | `nda` | `cim` | `pursuing` | `closed`.  
Aliases: `dead`/`pass` → `closed`; `shortlisted` → `shortlist`.

Token **or** a member session. Dirk uses the token. Optional `note` / `reason`.

---

## CIM (Simon) — `POST /api/next/cim-intake`

A CIM is an **https URL** you already created (Drive file, Canva, data room). Flow does not talk to Google and does not store the PDF.

Identity = pack link + TLY. TLY from `dealNumber`, a Flow `dealUrl` (`/next/deals/TLY-092` or `/cim/TLY-092`), or a filename that **starts with** `TLY-XXX`. Not from title.

**Single**

```json
{
  "cimUrl": "https://drive.google.com/file/d/FILE_ID/view",
  "dealNumber": "TLY-092",
  "cimName": "Project Cactus",
  "city": "Austin",
  "state": "TX",
  "ebitda": 920000
}
```

`link` is an alias for `cimUrl`. Optional: `revenue`, `ebitda`, `margin`, `asking`, `cimName`, `city`, `state`, `country`, `location`, `fileName`.

**Batch** (max 50). Each row is its own transaction — one unknown TLY does not undo the others.

```json
{
  "cims": [
    { "cimUrl": "https://drive.google.com/file/d/AAA/view", "dealNumber": "TLY-092" },
    { "link": "https://www.canva.com/design/BBB/view", "dealUrl": "/next/deals/TLY-014" }
  ]
}
```

Response: `{ ok, applied, failed, results: [...] }`. CLI: `python cim_intake.py --batch packs.json`.

Stamping a pack on a live deal moves it to stage CIM. **Closed stays closed. Pursuing stays pursuing.** Drive *folders* are rejected. `http://` and `javascript:` are rejected.

Prefer intake over posting a CIM as a new deal. Prefer intake over `/api/next/cim-url` + `/cim-financials` unless you only have one of those pieces.

| Path | What it does |
|------|----------------|
| `/api/next/cim-intake` | URL + optional numbers/name/geo + stage CIM (Simon’s default) |
| `/api/next/cim-url` | URL + stage CIM only |
| `/api/next/cim-financials` | Numbers only; **does not** change stage |

`GET /cim/TLY-XXX` is a **page** (session). It redirects to the stamped URL or says “CIM not in yet.” Agents do not need it.

---

## Merge duplicates — `POST /api/next/merge`

```json
{ "confirm": "MERGE" }
{ "confirm": "MERGE", "dryRun": true }
{ "confirm": "MERGE", "deleteDealNumbers": ["TLY-023", "TLY-024"] }
```

Token only. Keeps the lowest TLY when collapsing twins. Do not run this casually.

---

## Gmail threads — `POST /api/next/gmail-threads`

Import and merge only **union** `gmail_thread_ids`. This is how Dirk removes a wrong id or puts the correct thread first (daily move links use `[0]`).

```json
{ "dealNumber": "TLY-096", "mode": "replace", "gmailThreadIds": ["1a086a480b0fbc7e"] }
```

```bash
curl -sS -X POST "$BASE/api/next/gmail-threads" \
  -H "Authorization: Bearer $FLOW_IMPORT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dealNumber":"TLY-096","mode":"replace","gmailThreadIds":["1a086a480b0fbc7e"]}'
```

- `mode: "replace"` sets `deals_next.gmail_thread_ids` to that ordered JSON array. Dedupe keeps first occurrence. `[]` clears the column.
- `mode: "prepend"` puts the new ids first, then ids already on the card.
- `mode: "append"` is the same union import already does.
- A mail URL is stored as its thread id. `404` if the TLY is missing. `400` on a bad body.
- Response: `{ "ok": true, "dealNumber": "TLY-096", "gmailThreadIds": ["1a086a480b0fbc7e"] }`.
- Does not change `source_deal_id`, blank-fill, or stage.

---

## Harvest — `POST /api/import`

Used by `export_snapshot.py` after Mailman + ingest. Posts the **entire** SQLite snapshot as `{ "deals": [ ... ] }` to **`/api/import` only**. Bearer: **`PIPELINE_TOKEN` if present**, else `FLOW_IMPORT_TOKEN` (same value as Vercel). Same dealbook as Review (`deals_next`). Join is URL / source id / fingerprint — harvest `ext_id` is **not** a TLY key.

Unmatched rows whose `first_seen` is older than four days are skipped (`skipIfNew`) so the catalog does not flood Review. Matched TLY rows still get null-fills and last_seen. Fresh first_seen listings mint inbox.

If this POST fails, the Actions job fails; the SQLite artifact `nm-deals-db-v2` is still saved (Harve's 5:30 starts from `mail.label=listing` on that file, not Gmail). Next run restores and re-posts. Upsert is idempotent.

Do not also POST the same snapshot to `/api/next/import` — that would be a second writer. `/api/next/import` is Dirk/Harve structured TLY payloads (gmailThreadIds, remint fields).

---

## Cron — `GET|POST /api/cron/harvest`

Vercel Cron → dispatches `.github/workflows/daily-harvest.yml`. Auth is `CRON_SECRET`, not the import token. Agents should not poke this unless asked to kick a harvest. First stage of that workflow is `python mailman.py --days 2` (label mail). GitHub `schedule:` is backup only.

---

## Failure behavior

| What failed | What happens |
|-------------|--------------|
| Gmail harvest | Retried 3× in `run_daily_harvest.sh` |
| `POST /api/import` | Job fails; no retry; SQLite artifact kept; next harvest re-posts the full snapshot |
| `POST /api/next/import` mid-array | Earlier deals already committed; replay the JSON |
| `POST /api/next/cim-intake` batch | Per-item; `results[i].ok === false` for misses |
| Token path not in `PUBLIC_PATHS` | `307 /login?next=...` |

Nothing is queued on the server. If the POST never happens, Review does not see the deals. There is no ingest-file archive.

---

## Session-only (do not use)

These exist for the live app. They require Tristan/Jim’s cookie. Agents impersonating a member is forbidden.

- `POST /api/next/verdict` — New swipe
- `POST /api/next/cim/verdict` — CIM Pass / Hold / Pursue
- `POST /api/next/super-like`
- `POST /api/next/notes`
- `POST /api/next/cim` — browser attach (URL; leftover file upload still exists on prod UI)
- `POST /api/next/cim/create` — “Add from CIM” on the Next board
- `POST /api/db/resolve` — confirm/dismiss `/db` proposals
- Classic `/api/verdict`, `/api/notes`, `/api/stage`, `/api/train`, `/api/cim/extract`, `/api/outreach`, `/api/deal-files`, `/api/import/upload`, `/api/crm/attention`
- `POST /api/auth/login` — humans only

---

## Hard rules

1. **Agents never vote.** Votes are columns on `deals_next` (`tristan_verdict` / `jim_verdict` / CIM pair). Optional ingest `verdicts` park as `needs_review` on `deal_log` for a human to confirm on `/db`. Do not POST `/api/next/verdict`.
2. **Do not insert deals from CIM intake.** Stamp the existing TLY.
3. **Do not call Google from Vercel.** Simon creates the Drive/Canva file, then POSTs the URL.
4. **Do not flush** unless Tristan said so. Flush is `FLOW_IMPORT_TOKEN` only — Dirk/Simon/pipeline tokens cannot flush.
5. **Allowlist new token routes** in `web/middleware.ts` or they will 307 to login.
6. After a change is **on `main` and deployed**, append `docs/agents/CHANGELOG.md`. See [README.md](./README.md).

Code: `web/app/api/**/route.ts`. Product map: [SYSTEM.md](./SYSTEM.md).
