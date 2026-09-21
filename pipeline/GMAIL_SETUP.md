# Connect Mailman to dirk@ (Gmail API) — LIVE cloud harvest

Inbox stays **`dirk@tullyinvesting.com`**. Mailman holds the OAuth token that reads it. Dirk the agent is not this connection.

Goal: dirk@ → Mailman `mail` table → Harve ingest → Flow App, on GitHub Actions in **this repo**. Tristan's PC is not required for the catcher.

## 0. Mailbox

1. `dirk@tullyinvesting.com` is the catcher (already exists).
2. Filter `deliveredto:dirk@tullyinvesting.com` → **Never send it to Spam**.
3. Brokers / listing alerts stay pointed at dirk@.
4. Do **not** create a separate mailman@ inbox.

## 1. Google Cloud OAuth (Mailman's token)

1. Enable **Gmail API** on a Cloud project.
2. OAuth consent: Internal (or External + dirk@ as test user).
3. Desktop OAuth client → `pipeline/credentials/client_secret.json`.
4. Locally (once, or to rotate):

```powershell
cd pipeline
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python gmail_auth.py
```

Sign in as **dirk@**. Confirm: `Connected as: dirk@tullyinvesting.com`.
Token path: `pipeline/credentials/mailman_token.json` — that file is **Mailman's** access, not Dirk-the-agent's other work. Scope must be **`gmail.modify`**.

CI overrides (optional; Actions writes the default paths):

| Env | Default |
|-----|---------|
| `MAILMAN_CRED_DIR` | `pipeline/credentials` |
| `GMAIL_CLIENT_SECRET_PATH` | `$MAILMAN_CRED_DIR/client_secret.json` |
| `MAILMAN_TOKEN_PATH` | `$MAILMAN_CRED_DIR/mailman_token.json` |
| `NM_LOCAL_DB` | `pipeline/nm_deals.db` |

## 2. GitHub secrets

Existing repo secrets. **Do not invent new names.** Tristan must paste these in the GitHub UI — agents cannot write Actions secrets. If the PC token differs from GitHub, update `GMAIL_*` or the job will fail refresh.

| Secret | Value |
|--------|--------|
| `GMAIL_CLIENT_SECRET_JSON` | contents of `credentials/client_secret.json` |
| `GMAIL_TOKEN_JSON` | contents of `credentials/mailman_token.json` (dirk@, `gmail.modify`) |
| `FLOW_APP_URL` | `https://web-tau-seven-77.vercel.app` |
| `PIPELINE_TOKEN` | Preferred bearer for harvest `POST /api/import` (harvest/mailman lane). Optional if `FLOW_IMPORT_TOKEN` is set. |
| `FLOW_IMPORT_TOKEN` | Fallback; same value as Vercel. Daily dump is **`/api/import` only**, never `/api/next/import`. |
| `APIFY_TOKEN` | BizBuySell enrich (required on full harvest; skip with `mailman_only`) |

`.github/workflows/daily-harvest.yml` writes:

```bash
printf '%s' "$CLIENT" > credentials/client_secret.json
printf '%s' "$TOKEN" > credentials/mailman_token.json
```

working-directory: `pipeline`. First stage: `python mailman.py --days 2`.

### Rotate

`python gmail_auth.py --reauth` as dirk@ → paste new JSON into `GMAIL_TOKEN_JSON` (and `GMAIL_CLIENT_SECRET_JSON` if the client changed) → **Actions → Daily harvest → Run workflow** with **Stop after Mailman catcher** to confirm labels without Apify or Flow POST.

## 3. Scheduling

**Primary:** Vercel Cron → `GET /api/cron/harvest` → `workflow_dispatch` on `daily-harvest.yml` (also accepts `repository_dispatch` type `harvest`). GitHub's own `schedule:` never fired reliably here; treat it as backup.

| Clock | Expression | Meaning |
|-------|------------|---------|
| Vercel (`web/vercel.json`) | `17 10 * * *`, `23 19 * * *` | UTC. 5:17 AM / 2:23 PM **CDT**; during CST those are 4:17 AM / 1:23 PM CT. Vercel has no timezone field. Takes effect after a **prod deploy** of `web/`. |
| GitHub backup | `17 5 * * *` and `23 14 * * *` with `timezone: America/Chicago` | 5:17 AM and 2:23 PM CT year-round (odd minutes so GH is less likely to drop them). |

Job: Mailman fetch/label (`--days 2`) → **re-upload `nm-deals-db-v2`** (Harve's 5:30 shelf: `mail.label=listing`; he does not open Gmail) → Harve `ingest_mail.py` → Apify → POST `/api/import`. Never commit the DB. Never drop the artifact.

## 4. Local

```powershell
python gmail_auth.py
python mailman.py --days 2
python ingest_mail.py --days 2
```

Do not use `harvest_gmail.py --ingest` as the entry point. Mailman already fetched.
