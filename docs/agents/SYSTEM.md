# System map for agents (NM Deal Flow)

Last reviewed: 2026-09-21 · Primary author this pass: `nm/harvest/mailman-ci`

## 1. Product in one paragraph

Nails & Mercy deal flow: harvest broker/marketplace emails into structured deals, enrich where email is thin (BizBuySell via Apify), push a snapshot into the **Flow App** (Next.js on Vercel + Neon) where Tristan and partner review, shortlist, and move deals through a pipeline board.

Tristan tests on the **live** app, not a local-only stack (see `.cursor/rules/ship-fully.mdc`).

## 2. Runtime topology

```
┌─────────────────────────────────────────────────────────────┐
│ Vercel Cron → web/app/api/cron/harvest                      │
│   workflow_dispatch → .github/workflows/daily-harvest.yml   │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ pipeline/ (GitHub Actions ubuntu, cwd=pipeline)             │
│  1. Restore artifact nm-deals-db-v2 → nm_deals.db           │
│  2. mailman.py --days 2  (dirk@ via Mailman token → mail table) │
│  3. ingest_mail.py       (listing labels → nm_deals.db)     │
│  4. enrich_bizbuysell.py --backend apify --newest           │
│  5. CSV snapshot artifact                                   │
│  6. export_snapshot.py --post $FLOW_APP_URL /api/import     │
│     bearer PIPELINE_TOKEN else FLOW_IMPORT_TOKEN            │
│  7. Upload nm_deals.db artifact (Harve 5:30 shelf; always)  │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ Flow App (web/) Neon Postgres                               │
│  Review · Shortlist · Pipeline · Train AI                   │
└─────────────────────────────────────────────────────────────┘
```

**CIM packs:** `GET /cim/TLY-XXX` (session) redirects from `deals_next.cim_url` (https pack URL — Drive **file** or Canva/other https). No Google calls from Vercel. Missing URL → “CIM not in yet”. Token stamp: `POST /api/next/cim-url` writes the pack URL **and** moves a live deal to stage CIM (`stage_changed_at` / `by` = dirk). Combined intake (filename + URL + optional numbers + optional **`cimName`** + optional **`city`/`state`** + stage CIM on the existing TLY row): `POST /api/next/cim-intake`. Drive file links are canonicalized; any other well-formed `https://` URL is stored as-is. Drive folders, empty, `http://`, and `javascript:` are rejected. Same rule: a non-null pack URL means stage CIM. **Exception:** Closed stays Closed (Tristan already walked). Pursuing stays Pursuing (already past CIM). `cim_url` is never cleared when a deal later leaves CIM. Pack numbers only: `POST /api/next/cim-financials` (does not write stage). `cimName` writes `deals_next.cim_name` (company / project / nickname). Cards use it as the headline and keep teaser `title` as the subline. `city`/`state` overwrite `deals_next.city`/`state` when posted; omitted leaves existing geo. No `country` column — optional `country` maps to `state` when state is omitted (foreign HQ, e.g. Bermuda). A deal with `cim_url` must not show next-action / follow-up copy “Await CIM / data room” — that becomes “Review CIM against buy box”. Simon’s helper: `pipeline/cim_intake.py --cim-name --city --state`.

**Also:** CSV Drive sync is legacy/optional (`FLOW_DRIVE_FOLDER_ID`). Local PGlite is for dummy/dev only.

## 3. Attribution triad (everywhere)

| Field | Meaning | Example |
|-------|---------|---------|
| `source` | Sender domain | `bizbuysell.com` |
| `sub_source` | Sender email | `bizalert@bizbuysell.com` |
| `nickname` | UI label | `BizBuySell` |

Same names in SQLite, export JSON (`source` / `subSource` / `nickname`), and Neon.

## 4. Email → deal (ingest)

| Path | Role |
|------|------|
| `pipeline/mailman.py` | Mailman token reads dirk@ → `mail` table + coarse label |
| `pipeline/ingest_mail.py` | `label=listing` rows → ingest → `nm_deals.db` |
| `pipeline/harvest_gmail.py` | Shared Gmail fetch helper (Mailman token) |
| `pipeline/ingest.py` | Route, split, extract, in-memory dedupe |
| `pipeline/db.py` | Persistent upsert into `nm_deals.db` |
| `pipeline/formats/repertoire.yaml` | Format catalog / sender → format id |
| `pipeline/formats/catalog.py` | Runtime matcher for Train AI / survey |

**BizBuySell email shapes** (repertoire):

- `bizbuysell.bizalert_digest` — multi-listing digest (`bizalert@` / `alerts@`)
- `bizbuysell.newbizopps_single` — one listing (`newbizopps@`)

Email typically has: title, asking, location, **Profile URL**. Almost never SDE/EBITDA.

URL hygiene: `norm_url` / `url_norm` strips `utm_*`, `gclid`, etc. BBS emails often still carry `j`, `bn`, `bd` trackers in stored `url_norm`; enrich **re-canonicalizes** before fetch.

**Axial:** teaser emails list Pass (`action=decline`) before Pursue (`action=pursue`). Ingest `pick_listing_url` must store Pursue; Flow rewrites Pass→Pursue on read and on Open. Opening Pass archives the deal on Axial.

**Rejigg** (`rejigg.search_digest`): multi-lead digest from `info@notifications.rejigg.com` — split on `Added:` cards; Revenue/EBITDA/Located + `rejigg.com/app/businesses/{id}`. Subject (`and N other new leads`) is never the listing title.

**WebsiteClosers** (`websiteclosers.new_deal_alert`): Mailchimp single from `info@websiteclosers.com` — Asking Price / Sales→revenue / Earnings→SDE; listing URL under `/businesses/.../{id}/` (ignore mailchi + buyers-club).

## 4b. Pursuit loop (post-shortlist)

Axial’s pursue URL is the action key for life. Other sources use **Dirk inbox** as the action key after you Act.

```
Shortlist → interested (no watch)
Act / debrief → arm deal_expectations (nda | cim | broker_reply)
crm_pursuit harvest → type event → hard match (listing id | verbatim title)
  → applied: attach NDA/thread/CIM + fulfill expectation
  → needs_review: Attention panel (confirm / dismiss)
  → unmatched: Attention panel
```

Fuzzy title match never auto-applies unless an expectation is open (and even then only as `needs_review`).

## 5. BizBuySell page enrich (required on harvest)

| Path | Role |
|------|------|
| `pipeline/enrich_bizbuysell.py` | Select candidates → Apify → write money fields + thin blurbs |
| `pipeline/buybox.yaml` + `pipeline/score.py` | Headline exclusion check before Apify spend |
| `pipeline/run_daily_harvest.sh` | Calls enrich after ingest; **fails if no `APIFY_TOKEN`** |
| `.github/workflows/daily-harvest.yml` | Passes `secrets.APIFY_TOKEN`, `BBS_ENRICH_LIMIT=120` |

### Behavior

1. Candidates: BizBuySell URLs missing earnings **or** with a thin blurb (empty / headline echo).
2. **Buy-box skip:** if title/blurb hits excluded categories (restaurant, retail, franchise, …) and is not strategic → do **not** call Apify; stamp `rejected` / `reject_reason`.
3. Else build actor URL:  
   `https://www.bizbuysell.com/business-opportunity/{slugify(title)}/{listingId}/`  
   (Not `Profile/?q=` — that returns empty dataset on the store actor.)
4. Actor: `abotapi~bizbuysell-scraper` (override `APIFY_BBS_ACTOR`).
5. Map: `cashFlow`→`sde`, `ebitda`→`ebitda`, `grossRevenue`→`revenue`, fill nulls;
   `fullDescription`/`shortDescription`→`blurb` when the stored blurb is thin; clear `needs_llm` earnings when page checked.

### What failed in spikes (do not regress)

| Approach | Result |
|----------|--------|
| DIY Playwright / CI Chromium | Akamai Access Denied |
| Apify `playwright-scraper` + residential | Still Access Denied |
| Apify BBS actor + `Profile/?q=` | SUCCEEDED, **0 items** |
| Apify BBS actor + `/business-opportunity/{slug}/{id}/` | Works (~96% on 50-pack) |

### Secrets / local token

- CI: GitHub Actions secret `APIFY_TOKEN`
- Local: env `APIFY_TOKEN` or `pipeline/credentials/apify_token.txt` (gitignored)
- Needs Apify plan that can use **US residential** proxy (Starter+ in practice)

## 6. Merge / dedupe

`pipeline/db.py` `upsert`:

1. Same `ext_id` (same email) → **re-parse overwrite** (`REPARSE` fields)
2. Else same `url_norm`
3. Else fingerprint + state
4. Else fuzzy title + state

Cross-source merge **backfills nulls only** (does not clobber existing earnings). Enrich follows the same “fill nulls” spirit for money fields.

## 7. Flow App (`web/`)

| Area | Paths |
|------|--------|
| Schema | Run-once files in `web/db/migrations/` via `lib/migrations.ts` on first `getDb()` per process. Do **not** re-add per-request `schema.sql`. Never edit a migration that already ran in prod — add a new numbered file. |
| Dealbook | One dataset: `deals_next` (current state — votes, notes, watches are columns) + `deal_log` (append-only). Visual home: `/db`. Review (`/next` New + CIM), Pipeline (`/next/pipeline`), and `/api/next/*` are views of those tables. Harvest `POST /api/import` upserts the same `deals_next` (join on URL / source id / fingerprint; unmatched rows older than 4 days `skipIfNew`). Classic `deals` leftover tables stay in schema; `/pipeline` `/deals` `/import` 308 to the dealbook views. Flush still classic-only — it does not empty `deals_next`. |
| Import API | `web/app/api/import/` · harvest snapshot → `deals_next` · auth `PIPELINE_TOKEN` or `FLOW_IMPORT_TOKEN` |
| Next Dirk loop | `POST /api/next/import`, `POST /api/next/stage`, `POST /api/next/cim-url`, `POST /api/next/cim-financials`, `POST /api/next/cim-intake`, `POST /api/next/merge`, `POST /api/next/gmail-threads`, `GET /api/next/dirk` · same bearer. Middleware `PUBLIC_PATHS` must include each of these or a valid token 307s to `/login`. Stage operator is Dirk, not a browser session. Writes `deals_next` and `deal_log`. `POST /api/next/gmail-threads` with `mode: replace` overwrites `gmail_thread_ids` (ordered, deduped; `[]` clears). Import and merge still union thread ids. **Remint / attach-only (Harve):** `duplicateOf` (canonical `TLY-NNN`) + `ingestDisposition` (`new` \| `attached` \| `remint`). When `duplicateOf` hits an existing row or disposition is attached/remint, import merges `gmailThreadIds` / aliases / source ids onto that TLY and does **not** mint a live Review card (unknown target → Closed audit row with the fields set). Review hides remints; `blurb` is notes only. See `web/lib/next/remint.ts`. Board: Shortlisted → NDA → CIM → Pursuing → Closed (`inbox` is Next Review swipe, inbound only). `cim-financials` never writes `stage`. `cim-url` and `cim-intake` both set `cim_url` and advance a live deal to CIM (closed stays closed; pursuing stays pursuing; `cim_url` is not cleared on later stage moves). `cim-intake` stamps existing TLY rows (never inserts a deal or vote). Identity is pack URL + `dealNumber` / `dealUrl` / TLY `fileName`. One object or `{ "cims": [ … ] }` (per-item apply; one unknown TLY does not roll back the rest). Optional `cimName`→`cim_name`, optional `city`/`state`; omitted geo leaves existing city/state alone; optional `country` maps to `state` (no country column). |
| Seed (local PGlite) | `web/db/seed-data.json` via `seedIfEmpty()` when no `DATABASE_URL` |
| Buy-box UI fit | `web/lib/fit.ts` (display; pipeline `score.py` is rules for enrich skip / scoring) |
| Review UI | `web/components/next/review-client.tsx` · **`/` 308s to `/next`**. `/next` Review has **New** and **CIM**. New is swipe-only (`listNextInboxDeals()`, stage `inbox`); no List / no Swipe toggle. Tristan and Jim (`partner`, Jim Evans) each have their own inbound swipe deck via member session + `tristan_verdict` / `jim_verdict` on `deals_next`. Combine: either Like or Super Like → Shortlisted; both `?` → Shortlisted; both finished otherwise → Closed. Super Like also pins (`✓✓✓` is the rightmost swipe control). CIM is `listNextCimDeals()` on the same `deals_next` rows — every stage CIM card, plus open board rows with a stamped https pack `cim_url`. Intake or a stage move to CIM makes the card available immediately. CIM card: no teaser FitStrip; Super Like **star**; pack numbers revenue / EBITDA / margin / asking (omit missing); **View CIM** opens `/cim/TLY-XXX` in a new tab. `DealTitleStack` (New, CIM, `/next` board, deal detail) shows `cim_name` as the headline and teaser `title` as the quieter subline when `cim_name` is set; New swipe stays on the teaser until Simon sends `cimName`. CIM-stage cards always show **Tristan notes** and **Jim notes** (`cimPartnerNoteFields` / `CimPartnerNotes`) even when empty; the logged-in member writes via `POST /api/next/notes`. Partner field stays labeled with a quiet empty state. Hidden entirely before CIM. Simon is never rendered. CIM votes live in `tristan_cim_verdict` / `jim_cim_verdict` (Pass / Hold / Pursue). The board card stays CIM until Tristan and Jim both Pass (→ Closed) or both Pursue (→ Pursuing). Hold, mixed, or one vote stay CIM. Simon does not vote. No Google calls from Vercel. |
| Database page | `/db` — deals table + `deal_log` activity + agent `needs_review` queue. |
| Agent API | [API.md](./API.md) — token endpoints, CIM batch, ingest, what not to call. |
| CIM pack opener | `/cim/[id]` — looks up `deals_next.cim_url` (https pack URL stamped by Dirk / Simon) and redirects. No Google credentials on Vercel. Missing URL → “CIM not in yet”. |
| CIM → pipeline | `/next/pipeline` “Add from CIM” → `POST /api/next/cim/create` → same `deals_next` at stage `cim` (joins existing TLY on source id / fingerprint; never minting an inbound Review card). Classic `/pipeline` 308s here. Gmail teaser harvest lands inbound on the same table. |
| Pursuit CRM | `pipeline/crm_pursuit.py` after harvest · `POST /api/crm/pursuit` · NDA URL + Gmail thread ids on `deals_next`; stage NDA/CIM; `crm_events.deal_id` FK → `deals_next` |
| Gmail deep links | Canonical: `https://mail.google.com/mail/?authuser=dirk@tullyinvesting.com#all/{threadId}`. Inbox is dirk@; Mailman’s token reads it. Never `/mail/u/0`. |
| Train AI | `web/components/train-ai-button.tsx` · `POST/GET /api/train` — **listing** → repertoire; **criteria** (should-be-excluded / request change) → buy-box queue only. Criteria edits to `buybox.yaml`/`fit.ts` are **strong-trend / careful-exclude only** — most hard rules have exceptions. |
| Cron harvest trigger | `web/app/api/cron/harvest/route.ts` |

Local: `npm run dev` in `web/` with `.env.local` (passcodes + session secret). Restart required to re-seed PGlite from updated `seed-data.json`.

## 8. Key commands

```bash
# Harvest + ingest only (local) — Mailman then Harve; do not harvest_gmail --ingest
# Live catcher is GitHub Actions daily-harvest.yml (Vercel cron), not Tristan's PC.
cd pipeline && python mailman.py --days 2 && python ingest_mail.py --days 2

# Enrich (local)
python enrich_bizbuysell.py --backend apify --newest --limit 5
python enrich_bizbuysell.py --backend apify --newest --dry-run

# Export seed for local app
python export_snapshot.py --db nm_deals.db --out ../web/db/seed-data.json

# Trigger live harvest
gh workflow run "Daily harvest" --ref main
gh workflow run "Daily harvest" --ref main -f mailman_only=true
```

## 9. Related docs (deeper / adjacent)

- `docs/deal-aggregator-blueprint.md` — email-not-scrape discovery rationale
- `docs/deal-format-repertoire.md` / `pipeline/formats/` — format catalog
- `docs/Deal_Extraction_Format_Repertoire_Whitepaper.md` — extraction handoff
- `pipeline/GMAIL_SETUP.md` — Gmail + Actions secrets
- `docs/NM_Deal_Flow_Whitepaper.md` — product overview

## 10. Operational gotchas

- **SQLite artifact is the harvest memory.** Restored every CI run from `nm-deals-db-v2`. A bad local overwrite does not fix prod; CI artifact / Neon do.
- **Anthropic/receipt mail** has appeared in digests — watch ingest keep filters so non-deal mail does not become deals.
- **Another agent may own flush/purge** (`purge-bizbuysell.yml`, flush API). Coordinate via CHANGELOG; do not race Neon/SQLite wipes.
- Harvest job timeout is **60 minutes** (Apify can run several minutes for ~100 URLs).
