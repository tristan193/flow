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

## 3. Scheduling — clocks off (manual only)

File: `.github/workflows/daily-harvest.yml`

**2026-09-01:** Vercel Cron entries for `/api/cron/harvest` and GitHub
`schedule:` crons were removed. This pipeline no longer writes to Flow on a
clock. Live ingest is Dirk Gmail → `/next`. The Python harvest still exists
for a human-triggered run.

**Manual trigger chain:**

```
curl /api/cron/harvest  or  Actions → Run workflow  or  repository_dispatch
             →  Daily harvest workflow  →  Gmail → ingest → Flow App
```

`web/vercel.json` has `"crons": []`. The route `web/app/api/cron/harvest`
is kept so a curl still dispatches.

### Vercel env (still needed for a manual curl dispatch)

| Variable | Value |
|----------|-------|
| `CRON_SECRET` | Any long random string. Vercel sends it back as `Authorization: Bearer …`, and the route rejects anything else. |
| `GITHUB_DISPATCH_TOKEN` | GitHub fine-grained PAT — repo `tristan193/flow`, permission **Actions: Read and write** |

Optional overrides: `GITHUB_REPO`, `GITHUB_WORKFLOW_FILE`, `GITHUB_REF_NAME`.

### Manual test (no waiting)

```powershell
curl -X POST https://web-tau-seven-77.vercel.app/api/cron/harvest `
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

`{"ok":true,...}` means a new run appeared under Actions → Daily harvest.

### How to run by hand

- Actions → Daily harvest → **Run workflow**
- `repository_dispatch` type `harvest`
- curl `/api/cron/harvest` (above)

### Behavior

- **Lookback:** 3 days, so a skipped trigger cannot lose mail
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
