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

## 3. Daily workflow (and why native cron alone failed)

File: `.github/workflows/daily-harvest.yml`

**Reality check (2026-07-31):** GitHub’s `schedule:` trigger never fired for this
repo — every successful run was `workflow_dispatch` (manual). GitHub documents
that scheduled jobs are best-effort and can be **skipped under load**, especially
at the top of the hour. Triple redundancy at `:00` does not fix that.

### Reliable path — external cron → workflow_dispatch

Use a free external scheduler ([cron-job.org](https://cron-job.org) or Google
Cloud Scheduler) to POST to GitHub. That uses the same path as the green
“Run workflow” button.

1. GitHub → **Settings → Developer settings → Personal access tokens**
   - Fine-grained token on `tristan193/flow`
   - Permission: **Actions: Read and write**
   - Copy the token once
2. Create a repo Actions secret: `HARVEST_DISPATCH_TOKEN` = that PAT  
   (optional — only needed if you store it in GitHub; cron-job.org can hold it itself)
3. In cron-job.org, create a job:
   - **URL:** `https://api.github.com/repos/tristan193/flow/actions/workflows/daily-harvest.yml/dispatches`
   - **Method:** POST
   - **Headers:**
     - `Authorization: Bearer YOUR_PAT`
     - `Accept: application/vnd.github+json`
     - `X-GitHub-Api-Version: 2022-11-28`
   - **Body:** `{"ref":"main"}`
   - **Schedule:** e.g. `17 11,13,15 * * *` (6:17 / 8:17 / 10:17 UTC ≈ CT mornings)

### Soft backup — native GitHub cron (odd minutes)

Still configured at ~6:17 / 8:23 / 10:41 AM CT, but treat it as best-effort only.

### Manual

Actions → Daily harvest → Run workflow

### Behavior

- **Retries:** script tries 3× (1m / 5m / 15m backoff)
- **State:** previous `nm_deals.db` restored from last successful artifact
- **Live push:** `export_snapshot.py --post` into Flow App after ingest
- **Backup outputs:** artifacts `nm-deals-db-v2` and `deals-csv`

## 4. Local scripts (dev / one-off only)

```powershell
python harvest_gmail.py --days 1 --ingest
python export_snapshot.py --post https://web-tau-seven-77.vercel.app --token $env:FLOW_IMPORT_TOKEN
```

Do **not** register a Windows Scheduled Task for production. `register_daily_task.ps1` is legacy — cloud is the source of truth.
