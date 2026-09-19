# Connect Mailman to dirk@ (Gmail API) — LIVE cloud harvest

Inbox stays **`dirk@tullyinvesting.com`**. Mailman holds the OAuth token that reads it. Dirk the agent is not this connection.

Goal: dirk@ → Mailman `mail` table → Harve ingest → Flow App, on GitHub Actions.

## 0. Mailbox

1. `dirk@tullyinvesting.com` is the catcher (already exists).
2. Filter `deliveredto:dirk@tullyinvesting.com` → **Never send it to Spam**.
3. Brokers / listing alerts stay pointed at dirk@.
4. Do **not** create a separate mailman@ inbox.

## 1. Google Cloud OAuth (Mailman’s token)

1. Enable **Gmail API** on a Cloud project.
2. OAuth consent: Internal (or External + dirk@ as test user).
3. Desktop OAuth client → `pipeline/credentials/client_secret.json`.
4. Locally (once):

```powershell
cd pipeline
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python gmail_auth.py
```

Sign in as **dirk@**. Confirm: `Connected as: dirk@tullyinvesting.com`.
Token path: `pipeline/credentials/mailman_token.json` — that file is **Mailman’s** access, not Dirk-the-agent’s other work.

## 2. GitHub secrets

| Secret | Value |
|--------|--------|
| `GMAIL_CLIENT_SECRET_JSON` | `credentials/client_secret.json` |
| `GMAIL_TOKEN_JSON` | `credentials/mailman_token.json` |
| `FLOW_APP_URL` | `https://web-tau-seven-77.vercel.app` |
| `FLOW_IMPORT_TOKEN` | Same as Vercel (harvest POST stamps actor **mailman**) |

## 3. Scheduling

Unchanged: Vercel Cron → Daily harvest. Job: Mailman fetch/label → Harve ingest listing mail → Apify → POST `/api/import`.

## 4. Local

```powershell
python gmail_auth.py
python mailman.py --days 3
python ingest_mail.py --days 3
```
