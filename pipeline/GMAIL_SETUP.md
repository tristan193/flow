# Connect dirk@ (Gmail API) — LIVE cloud harvest

**This is the live deal pipeline.** It feeds Flow App. Google Drive is not used.

Goal: durable harvest for `dirk@tullyinvesting.com` → `ingest.py` → Flow App,
running on **GitHub Actions** (not Tristan's laptop).

## 0. Mailbox

1. `dirk@tullyinvesting.com` exists as a Google Workspace user.
2. In Gmail (as dirk), filter `deliveredto:dirk@tullyinvesting.com` → **Never send it to Spam**.
3. Point brokers / listing alerts at dirk@ (or forward `deals@` → dirk@).

## 1. Google Cloud OAuth (one-time on any machine)

1. Enable **Gmail API** on a Cloud project.
2. OAuth consent: Internal (or External + dirk as test user).
3. Create **Desktop** OAuth client → save JSON as `pipeline/credentials/client_secret.json`.
4. Locally (once):

```powershell
cd pipeline
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python gmail_auth.py
```

Sign in as **dirk@**. Confirm: `Connected as: dirk@tullyinvesting.com`.

## 2. GitHub secrets (required for cloud runs)

In the repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|--------|--------|
| `GMAIL_CLIENT_SECRET_JSON` | Full contents of `credentials/client_secret.json` |
| `GMAIL_TOKEN_JSON` | Full contents of `credentials/token.json` |
| `FLOW_APP_URL` | `https://web-tau-seven-77.vercel.app` |
| `FLOW_IMPORT_TOKEN` | Same value as Vercel project env `FLOW_IMPORT_TOKEN` |

**Required.** If either is missing, the “Push snapshot to Flow App” step fails the workflow. Harvest artifacts are still uploaded, but Flow App will not update.

## 3. Daily workflow

File: `.github/workflows/daily-harvest.yml`

- **Cron:** `0 11 * * *` (11:00 UTC ≈ 6am Central)
- **Manual:** Actions → Daily harvest → Run workflow
- **Retries:** script tries 3× (1m / 5m / 15m backoff)
- **State:** previous `nm_deals.db` restored from last successful artifact, then re-uploaded
- **Live push:** `export_snapshot.py --post` into Flow App after a successful ingest
- **Backup outputs:** artifacts `nm-deals-db` and `deals-csv`

## 4. Local scripts (dev / one-off only)

```powershell
python harvest_gmail.py --days 1 --ingest
python export_snapshot.py --post https://web-tau-seven-77.vercel.app --token $env:FLOW_IMPORT_TOKEN
```

Do **not** register a Windows Scheduled Task for production. `register_daily_task.ps1` is legacy — cloud is the source of truth.
