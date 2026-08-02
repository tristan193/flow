# Flow App

Deal review and pipeline for **Nails & Mercy**. Shared web app for Tristan and partner.

## Live architecture

```
dirk@tullyinvesting.com
   │  GitHub Actions · Daily harvest (cron 11:00 UTC / manual)
   ├─ harvest_gmail.py → ingest.py → nm_deals.db
   └─ export_snapshot.py --post → Flow App /api/import
                                      │
                                      ▼
                         https://web-tau-seven-77.vercel.app
                         (review · shortlist · pipeline)
```

**Google Drive is not part of the live path.** CSV artifacts from the harvest are kept on Actions for backup only.

### Deal attribution (organizational contract)

Every listing carries three fields — same names in pipeline, DB, and Flow App:

| Field | Meaning | Example |
|-------|---------|---------|
| `source` | Sender domain | `bizbuysell.com` |
| `sub_source` | Sender email address | `bizalert@bizbuysell.com` |
| `nickname` | Human-facing label (UI pill) | `BizBuySell` |

UI may truncate for display; storage keeps full values. Format catalog:
[`docs/deal-format-repertoire.md`](docs/deal-format-repertoire.md).

## What Flow App does

- **Review** — swipe or list; shortlist / discuss / pass with live shared verdicts
- **Pipeline** — shortlisted deals on a board (contacted → NDA → CIM → offer → closed / dead)
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
| Tristan | `nails`  |
| Partner | `mercy`  |

## Flow App environment (Vercel)

| Variable | Purpose |
|----------|---------|
| `FLOW_SESSION_SECRET` | Random 32+ char string for signed cookies |
| `FLOW_PASSCODE_TRISTAN` | Tristan's passcode |
| `FLOW_PASSCODE_PARTNER` | Partner's passcode |
| `FLOW_IMPORT_TOKEN` | Bearer for `POST /api/import` |
| `DATABASE_URL` | Neon / hosted Postgres |

## Manual push (dev / one-off)

```powershell
cd pipeline
python export_snapshot.py --post https://web-tau-seven-77.vercel.app --token $env:FLOW_IMPORT_TOKEN
```

Buy-box scoring (`pipeline/buybox.yaml`, `pipeline/score.py`) stays parked until you agree criteria against real flow.
