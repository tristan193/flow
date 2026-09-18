# Flow App API (for agents)

One origin. Not many ports.

```
https://web-tau-seven-77.vercel.app
```

Every call is HTTPS to that host. There is no separate ingest port, CIM port, or Dirk port. Middleware either lets a **bearer token** through or requires a **browser session cookie**. A token POST to a path that is not on the allowlist `307`s to `/login` — that looks like “the API is down.” Check `web/middleware.ts` `PUBLIC_PATHS` first.

Live Next deals live in `deals_next` (TLY numbers). Classic harvest still posts to the old `deals` table. **Next Review does not read `deals`.** If you are Dirk or Simon, use `/api/next/*`.

---

## Auth

| Who | How |
|-----|-----|
| Dirk / Simon / harvest | `Authorization: Bearer $FLOW_IMPORT_TOKEN` |
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
| POST | `/api/next/import` | Dirk / Harve | `deals_next` (mint or join TLY) |
| GET | `/api/next/dirk` | Dirk | none (poll) |
| POST | `/api/next/stage` | Dirk | stage on an existing TLY |
| POST | `/api/next/cim-intake` | **Simon** | pack URL (+ optional numbers/name/geo) on existing TLY |
| POST | `/api/next/cim-url` | Dirk | pack URL only + stage CIM |
| POST | `/api/next/cim-financials` | Dirk / Simon | pack numbers only; **no stage** |
| POST | `/api/next/merge` | Dirk / ops | collapse duplicate TLY rows |
| POST | `/api/import` | harvest only | classic `deals` (not Review) |
| POST | `/api/crm/pursuit` | harvest | NDA / thread attach on classic+Next match |
| GET/POST | `/api/cron/harvest` | Vercel Cron | dispatches GitHub Actions |

**Humans (session).** Review swipe, notes, Train AI, `/db` confirm. Agents **must not** call these. You cannot cast votes.

**Do not call unless Tristan explicitly asked:** `POST /api/import/flush` (`FLUSH` / `PURGE`). Classic `deals` only — it does not empty Next.

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

## Classic harvest — `POST /api/import`

Used by `export_snapshot.py` after Gmail harvest. Posts the **entire** SQLite snapshot as `{ "deals": [ ... ] }` keyed by harvest `ext_id`. Fills classic `deals`. **Does not mint TLY cards.**

If this POST fails, the Actions job fails; the SQLite artifact is still saved. Next run restores and re-posts. Upsert is idempotent.

Do not send Next/TLY payloads here.

---

## Cron — `GET|POST /api/cron/harvest`

Vercel Cron → dispatches `.github/workflows/daily-harvest.yml`. Auth is `CRON_SECRET`, not the import token. Agents should not poke this unless asked to kick a harvest.

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

1. **Agents never vote.** No `verdicts_next`, no `cim_verdicts_next`, no “cast Tristan’s Like.”
2. **Do not insert deals from CIM intake.** Stamp the existing TLY.
3. **Do not call Google from Vercel.** Simon creates the Drive/Canva file, then POSTs the URL.
4. **Do not flush** unless Tristan said so, and never with an agent-only token if that split is live (`FLOW_IMPORT_TOKEN` is required today).
5. **Allowlist new token routes** in `web/middleware.ts` or they will 307 to login.
6. After a change is **on `main` and deployed**, append `docs/agents/CHANGELOG.md`. See [README.md](./README.md).

Code: `web/app/api/**/route.ts`. Product map: [SYSTEM.md](./SYSTEM.md).
