# Flow App

Deal review and pipeline for **Nails & Mercy**. Replaces the old Cowork HTML artifact with a shared web app both partners can use from phone or laptop.

## What it does

- **Review** — swipe or list through deals; shortlist / discuss / pass with live shared verdicts
- **Pipeline** — shortlisted deals move onto a board (contacted → NDA → CIM → offer → closed / dead)
- **Data** — import fresh deals from Google Drive CSV snapshots or a manual upload

The Python email ingestion pipeline (`pipeline/`) is unchanged and still owns extraction. Flow App is where you review and track deals.

## Local development

```powershell
cd web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Default local passcodes (in `web/.env.local`, not committed):

| Person  | Passcode |
|---------|----------|
| Tristan | `nails`  |
| Partner | `mercy`  |

On first boot the app seeds itself from `web/db/seed-data.json` (exported from the existing `nm_deals.db`). Local Postgres data lives outside OneDrive at `%LOCALAPPDATA%\flow-app\pglite` so cloud sync cannot corrupt it.

## Environment

| Variable | Purpose |
|----------|---------|
| `FLOW_SESSION_SECRET` | Random 32+ char string for signed cookies |
| `FLOW_PASSCODE_TRISTAN` | Tristan's passcode |
| `FLOW_PASSCODE_PARTNER` | Partner's passcode |
| `FLOW_IMPORT_TOKEN` | Bearer token for `POST /api/import` from the pipeline |
| `FLOW_DRIVE_FOLDER_ID` | Shared Drive folder id |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account key (JSON or base64) for Drive |
| `DATABASE_URL` | Hosted Postgres URL (omit for local embedded Postgres) |

## Pushing deals from the pipeline

```powershell
cd pipeline
python export_snapshot.py --post https://YOUR_APP_URL --token YOUR_IMPORT_TOKEN
```

Or write a seed file:

```powershell
python export_snapshot.py
```

## Connecting Google Drive

1. Create a Google Cloud service account and download its JSON key.
2. Share [the Drive folder](https://drive.google.com/drive/u/0/folders/0AIRHZYgxe1w-Uk9PVA) with the service account email as **Viewer**.
3. Set `GOOGLE_SERVICE_ACCOUNT_JSON` (paste the JSON, or base64-encode it) and `FLOW_DRIVE_FOLDER_ID=0AIRHZYgxe1w-Uk9PVA`.
4. Use **Data → Sync from Drive** in the app.

Drive sync only imports CSV snapshots (`nails-mercy-deals-*.csv`). Old browser verdict logs stay in Drive but are no longer needed — verdicts live in the app database now.

## Deploy (hosted)

Recommended: Vercel + Neon (or any Postgres).

1. Create a Neon/Postgres database and set `DATABASE_URL`.
2. Set the Flow env vars above (including both passcodes and a strong session secret).
3. Deploy the `web/` directory.
4. Optionally wire Drive with the service account.

Buy-box scoring (`pipeline/buybox.yaml`, `pipeline/score.py`) stays parked until you agree criteria against real flow.
