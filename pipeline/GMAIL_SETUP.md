# Connect dirk@ (Gmail API) — cloud harvest, no PC scheduler

Goal: durable harvest for `dirk@tullyinvesting.com` that feeds `ingest.py`,
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

## 3. Daily workflow

File: `.github/workflows/daily-harvest.yml`

- **Cron:** `0 11 * * *` (11:00 UTC ≈ 6am Central)
- **Manual:** Actions → Daily harvest → Run workflow
- **Retries:** script tries 3× (1m / 5m / 15m backoff). If the job still fails, open Actions and click **Re-run jobs** (or fix secrets and re-run).
- **State:** previous `nm_deals.db` is restored from the last successful artifact, then re-uploaded (90-day retention).
- **Outputs:** artifacts `nm-deals-db` and `deals-csv`.

Flow App import / Drive upload can be wired later (`export_snapshot.py --post`).

## 4. Local scripts (dev / one-off only)

```powershell
python harvest_gmail.py --days 1 --ingest
```

Do **not** register a Windows Scheduled Task for production. `register_daily_task.ps1` is legacy — cloud is the source of truth.
