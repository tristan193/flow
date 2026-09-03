# System map for agents (NM Deal Flow)

Last reviewed: 2026-09-03 · Primary author this pass: `nm/web/review-cim-fix`

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
│  2. harvest_gmail.py --days 3 --ingest                      │
│  3. enrich_bizbuysell.py --backend apify --newest           │
│  4. CSV snapshot artifact                                   │
│  5. export_snapshot.py --post $FLOW_APP_URL /api/import     │
│  6. Upload nm_deals.db artifact                             │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ Flow App (web/) Neon Postgres                               │
│  Review · Shortlist · Pipeline · Train AI                   │
└─────────────────────────────────────────────────────────────┘
```

**CIM packs:** `GET /cim/TLY-XXX` (session) redirects from `deals_next.cim_url` (Drive **file** URL stamped by Dirk). No Google calls from Vercel. Missing URL → “CIM not in yet”. Token stamp: `POST /api/next/cim-url`. Pack numbers: `POST /api/next/cim-financials`.

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
| `pipeline/harvest_gmail.py` | Gmail API → `RawEmail` |
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
| Import API | `web/app/api/import/` · auth `FLOW_IMPORT_TOKEN` |
| Next Dirk loop | `POST /api/next/import`, `POST /api/next/stage`, `POST /api/next/cim-url`, `POST /api/next/cim-financials`, `POST /api/next/merge`, `GET /api/next/dirk` · same bearer. Middleware `PUBLIC_PATHS` must include each of these or a valid token 307s to `/login`. Stage operator is Dirk, not a browser session. Writes `deals_next` only. Board: Shortlisted → NDA → CIM → Pursuing → Closed (`inbox` is Next Review swipe, inbound only). `cim-financials` never writes `stage`. |
| Seed (local PGlite) | `web/db/seed-data.json` via `seedIfEmpty()` when no `DATABASE_URL` |
| Buy-box UI fit | `web/lib/fit.ts` (display; pipeline `score.py` is rules for enrich skip / scoring) |
| Review UI | `web/components/next/review-client.tsx` · `/next` Review has **New** and **CIM**. New is swipe-only (`listNextInboxDeals()`, stage `inbox`); no List / no Swipe toggle. Tristan and Jim (`partner`, Jim Evans) each have their own inbound swipe deck via member session + `verdicts_next`. Combine: either Like or Super Like → Shortlisted; both `?` → Shortlisted; both finished otherwise → Closed. Super Like also pins (`✓✓✓` is the rightmost swipe control). CIM is `listNextCimDeals()` — stamped Drive **file** `cim_url` only (stage CIM alone is not enough; TLY-001 stays off the deck until a pack exists). CIM card: no teaser FitStrip; Super Like **star**; pack numbers revenue / EBITDA / margin / asking (omit missing); **View CIM** opens `/cim/TLY-XXX` in a new tab. Votes live in `cim_verdicts_next` (Pass / Hold / Pursue). The board card stays CIM until Tristan and Jim both Pass (→ Closed) or both Pursue (→ Pursuing). Hold, mixed, or one vote stay CIM. Simon does not vote. No notes UI. No Google calls from Vercel. |
| CIM pack opener | `/cim/[id]` — looks up `deals_next.cim_url` (Drive **file** URL stamped by Dirk) and redirects. No Google credentials on Vercel. Missing URL → “CIM not in yet”. |
| CIM → pipeline | Classic `/pipeline` still uses `POST /api/cim/extract` + `/create` → `deals`. `/next/pipeline` “Add from CIM” → `POST /api/next/cim/create` → `deals_next` at stage `cim` (joins existing TLY on source id / fingerprint; never minting an inbound Review card). Gmail teaser harvest still lands inbound. |
| Pursuit CRM | `pipeline/crm_pursuit.py` after harvest · `POST /api/crm/pursuit` · NDA URL + Gmail thread on deal; CIM auto-attach |
| Train AI | `web/components/train-ai-button.tsx` · `POST/GET /api/train` — **listing** → repertoire; **criteria** (should-be-excluded / request change) → buy-box queue only. Criteria edits to `buybox.yaml`/`fit.ts` are **strong-trend / careful-exclude only** — most hard rules have exceptions. |
| Cron harvest trigger | `web/app/api/cron/harvest/route.ts` |

Local: `npm run dev` in `web/` with `.env.local` (passcodes + session secret). Restart required to re-seed PGlite from updated `seed-data.json`.

## 8. Key commands

```bash
# Harvest + ingest only (local)
cd pipeline && python harvest_gmail.py --days 2 --ingest

# Enrich (local)
python enrich_bizbuysell.py --backend apify --newest --limit 5
python enrich_bizbuysell.py --backend apify --newest --dry-run

# Export seed for local app
python export_snapshot.py --db nm_deals.db --out ../web/db/seed-data.json

# Trigger live harvest
gh workflow run "Daily harvest" --ref main
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
