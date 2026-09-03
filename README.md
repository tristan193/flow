# Flow App

Deal review and pipeline for **Nails & Mercy**. Shared web app for Tristan and partner.

## Live architecture

```
dirk@tullyinvesting.com
   │  GitHub Actions · Daily harvest (Vercel cron / manual)
   ├─ harvest_gmail.py → ingest.py → nm_deals.db
   ├─ enrich_bizbuysell.py (Apify) → SDE/EBITDA on BizBuySell URLs
   └─ export_snapshot.py --post → Flow App /api/import
                                      │
                                      ▼
                         https://web-tau-seven-77.vercel.app
                         (review · shortlist · pipeline)
```

**Google Drive is not part of the live path.** CSV artifacts from the harvest are kept on Actions for backup only.

**Agents:** how the system works, naming, and change annotations — [`docs/agents/`](docs/agents/README.md).

### Deal attribution (organizational contract)

Every listing carries three fields — same names in pipeline, DB, and Flow App:

| Field | Meaning | Example |
|-------|---------|---------|
| `source` | Sender domain | `bizbuysell.com` |
| `sub_source` | Sender email address | `bizalert@bizbuysell.com` |
| `nickname` | Human-facing label (UI pill) | `BizBuySell` |

UI may truncate for display; storage keeps full values. Format catalog:
[`docs/deal-format-repertoire.md`](docs/deal-format-repertoire.md).
Agent handoff (intent, findings, docs):
[`docs/Deal_Extraction_Format_Repertoire_Whitepaper.md`](docs/Deal_Extraction_Format_Repertoire_Whitepaper.md).

## Original vs Next

| | **Original (fallback)** | **Next (experimental)** |
|---|---|---|
| UI | `/pipeline` (classic board; `/` 308s to `/next`) | `/next` Review · `/next/pipeline` |
| Import | `POST /api/import` — live harvest still posts here | `POST /api/next/import` |
| Dirk poll | none | `GET /api/next/dirk` |
| Stage move | session cookie | **Dirk token** `POST /api/next/stage` `{ dealNumber, stage }` (session still works) |
| Merge dups | none | `POST /api/next/merge` (import token) |
| Tables | `deals`, `verdicts`, … | `deals_next`, `verdicts_next`, … |
| Identity | harvest `ext_id` (`format:gmail_msg:index`) | `TLY-001` + source ID + fingerprint |

**If anything on Next breaks, use `/` and `/pipeline`.** Login passcodes and the harvest → `/api/import` path are unchanged.

Next deal numbers mint `TLY-001` on first touch. Join order: deal number → source ID (Axial hex from Pursue/Pass HTML, BBS `q=`, V-AID, Transworld) → fingerprint (teaser + broker + round(EBITDA) + geo). Aliases and `gmail_thread_ids[]` accumulate. Never broker-only. Never one Gmail thread = one deal.

Dirk is the stage operator (`FLOW_IMPORT_TOKEN` on `POST /api/next/stage` or import `stage` / `proposedStage`). Canonical board: `shortlist` → `nda` → `cim` → `pursuing` → `closed` (`inbox` is Next Review, not a column). Closed = passed / dead / walked, not won. Legacy aliases: `pof` / `nda_to_sign` / `nda_signed` → `nda`; `awaiting_reply` / `active` → `pursuing`; `dead` / `pass` / `passed` → `closed`.

CIM intake (Simon, after the PDF is already in the shared Drive parent):

```powershell
python pipeline/cim_intake.py --file-name "TLY-092 Headline.pdf" --cim-url "https://drive.google.com/file/d/FILE_ID/view" --cim-name "Project Cactus"
```

`POST /api/next/cim-intake` with the same bearer. Updates the existing `TLY-XXX` `deals_next` row only (`cim_url`, provided financials, optional `cimName` → `deals_next.cim_name`, stage CIM). Does not create a card or vote. No Google credentials on Vercel.

Simon’s CIM display name JSON key is **`cimName`** (aliases: `cim_name`, `companyName`, `company_name`, `headline`). When present and non-empty it writes `deals_next.cim_name`. Cards then show that as the headline and keep the teaser in `title` as the quieter subline. Omitted/empty leaves both fields alone. Teaser `title` is never overwritten, so aliases/search still match the old listing name.

## What Flow App does

- **Review** — swipe or list; shortlist / discuss / pass with live shared verdicts
- **Pipeline** — shortlisted deals on a board (contacted → NDA → CIM → offer → closed / dead)
- **Next** — experimental rebuild of cards → board → CIM → Dirk APIs (`/next`)
- **Data** — status of the live harvest; manual CSV upload as fallback

## Pipeline setup (Gmail → Actions)

See [`pipeline/GMAIL_SETUP.md`](pipeline/GMAIL_SETUP.md).

GitHub Actions secrets:

| Secret | Purpose |
|--------|---------|
| `GMAIL_CLIENT_SECRET_JSON` | OAuth client for dirk@ |
| `GMAIL_TOKEN_JSON` | Refresh token from `gmail_auth.py` |
| `FLOW_APP_URL` | e.g. `https://web-tau-seven-77.vercel.app` |
| `FLOW_IMPORT_TOKEN` | Same bearer token as Vercel `FLOW_IMPORT_TOKEN` |

## Local development (web)

```powershell
cd web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Person  | Passcode (local `.env.local`) |
|---------|-------------------------------|
| Tristan Tully | `nails`  |
| Jim Evans (`partner`) | `mercy`  |

## Flow App environment (Vercel)

| Variable | Purpose |
|----------|---------|
| `FLOW_SESSION_SECRET` | Random 32+ char string for signed cookies |
| `FLOW_PASSCODE_TRISTAN` | Tristan Tully's passcode |
| `FLOW_PASSCODE_PARTNER` | Jim Evans's passcode (same `/login` — own Review deck) |
| `FLOW_MEMBER_PARTNER_LABEL` | Optional UI label (default **Jim Evans**; id stays `partner`) |
| `FLOW_IMPORT_TOKEN` | Bearer for `POST /api/import` and `POST /api/next/import` / `POST /api/next/merge` / `POST /api/next/cim-intake` / `GET /api/next/dirk` |
| `DATABASE_URL` | Neon / hosted Postgres |

## Manual push (dev / one-off)

```powershell
cd pipeline
python export_snapshot.py --post https://web-tau-seven-77.vercel.app --token $env:FLOW_IMPORT_TOKEN
```

Buy-box scoring (`pipeline/buybox.yaml`, `pipeline/score.py`) stays parked until you agree criteria against real flow.
