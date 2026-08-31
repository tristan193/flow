# Flow App

Deal review and pipeline for **Nails & Mercy** (Tully Investing). Shared web app for Tristan and Jimmy.

Live: https://web-tau-seven-77.vercel.app

## Live architecture

```
Dirk updates inbound
   │  POST /api/import   (primary — deal number + source id / fingerprint)
   │  GET  /api/dirk     (verdicts + open follow-ups for Dirk)
   │
   ▼
Review cards  →  verdicts (short / discuss / pass)
   │
   ▼
Pipeline board holds state
   Inbound → Shortlisted → POF → NDA to sign → NDA signed
          → CIM / data room → Awaiting reply → Active review → Pass/dead
   │
   ▼
Dirk sees verdicts + next actions, then prompts
   NDA · CIM · reply to banker  (Gmail deep links)
```

**GitHub Actions daily harvest is optional backup**, not the primary story. When it runs it still harvests dirk@ mail, parses listings, and POSTs the same `/api/import` contract.

**Google Drive is not part of the live path.**

**Agents:** how the system works, naming, and change annotations — [`docs/agents/`](docs/agents/).

### Deal attribution (organizational contract)

Every listing carries three fields — same names in pipeline, DB, and Flow App:

| Field | Meaning | Example |
|-------|---------|---------|
| `source` | Sender domain | `bizbuysell.com` |
| `sub_source` | Sender email address | `bizalert@bizbuysell.com` |
| `nickname` | Human-facing label (UI pill) | `BizBuySell` |

Plus a durable internal **deal number** on first touch (`TLY-001`). Never wait for a broker ID.

### Identity (how two emails become one deal)

Join order — never skip to a weaker key:

1. **Deal number** (`TLY-001`) if Dirk already has it.
2. **Source ID** when one exists:
   - Axial hex from HTML Pursue/Pass URLs (not the subject)
   - BizBuySell listing `q=`
   - V-AID 6-digit subject code
   - Transworld `####-######`
3. Else **fingerprint** = `normalize(teaser_name) + broker_firm + round(EBITDA) + geo`.

Also:

- `alias_names[]` — Axial CIM titles often differ from teasers.
- `gmail_thread_ids[]` — off-Axial brokers split one deal across 4–6 threads. Never assume one Gmail thread = one deal.
- **Never** match on broker name alone (one banker can have multiple live deals).
- Axial **Action Summary** is a work queue, not deals.
- AHC / Baton / editorial blasts: one email ≠ one deal (skipped). Rejigg / SMB Deal Hunter digests still **split** into many listings.

Shared implementation: [`web/lib/identity.ts`](web/lib/identity.ts) and [`pipeline/identity.py`](pipeline/identity.py). Tests: `cd web && npm test` and `python3 -m unittest pipeline.test_identity`.

## What Flow App does

- **Review** — swipe or list; shortlist / discuss / pass (card UX unchanged)
- **Pipeline** — shortlisting a card puts it on a board that holds state
- **CIM** — attach a file; reviewer scores against the **draft** buy box (`pipeline/buybox.yaml`). Empty dislike / hard-no lists are empty on purpose — not hallucinated.
- **Dirk feed** — authenticated read of inbound, latest verdicts, open follow-ups

## Dirk API

Same bearer token as harvest: `FLOW_IMPORT_TOKEN`.

### POST deals (idempotent)

```bash
curl -sS https://web-tau-seven-77.vercel.app/api/import \
  -H "Authorization: Bearer $FLOW_IMPORT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deals": [{
      "title": "Established HVAC & Plumbing",
      "source": "bizbuysell.com",
      "subSource": "bizalert@bizbuysell.com",
      "nickname": "BizBuySell",
      "url": "https://www.bizbuysell.com/business-opportunity/Profile/?q=2214412",
      "html": "<a href=\"https://www.bizbuysell.com/business-opportunity/Profile/?q=2214412\">listing</a>",
      "gmailThreadIds": ["18f0threadAAA"],
      "brokerFirm": "CTX Brokers",
      "city": "Georgetown",
      "state": "TX",
      "ebitda": 505000
    }]
  }'
```

A second email about the same listing (different thread, or a CIM rename) should include the source ID or the same fingerprint. The response is `{ ok, dealsNew, dealsUpdated, skipped }`. You can also send `dealNumber: "TLY-014"` to update a known deal.

Optional fields: `dealNumber`, `sourceDealId`, `sourceIds`, `aliasNames`, `fingerprint`, `nextAction`, `subject`, `body`, `html`.

### GET verdicts / inbound / follow-ups

```bash
curl -sS https://web-tau-seven-77.vercel.app/api/dirk \
  -H "Authorization: Bearer $FLOW_IMPORT_TOKEN"

curl -sS "https://web-tau-seven-77.vercel.app/api/dirk?section=verdicts" \
  -H "Authorization: Bearer $FLOW_IMPORT_TOKEN"
```

`section` may be `inbound`, `verdicts`, or `followups`. Gmail links use `https://mail.google.com/mail/u/0/#all/{threadId}`.

## Pipeline setup (optional Gmail harvest backup)

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

Open [http://localhost:3000](http://localhost:3000). Local PGlite seeds from `web/db/seed-data.json` — that file is a **DEMO fixture**, not live inventory.

| Person  | Passcode (local `.env.local`) |
|---------|-------------------------------|
| Tristan | `nails`  |
| Jimmy   | `mercy`  |

```powershell
cd web && npm test
python3 -m unittest pipeline.test_identity
```

## Flow App environment (Vercel)

| Variable | Purpose |
|----------|---------|
| `FLOW_SESSION_SECRET` | Random 32+ char string for signed cookies |
| `FLOW_PASSCODE_TRISTAN` | Tristan's passcode |
| `FLOW_PASSCODE_PARTNER` | Partner's passcode |
| `FLOW_IMPORT_TOKEN` | Bearer for `POST /api/import` and `GET /api/dirk` |
| `DATABASE_URL` | Neon / hosted Postgres |

Buy box (`pipeline/buybox.yaml`, `web/lib/fit.ts`) is **DRAFT / inferred** until Tristan edits it. Learned dislikes and extra hard-nos start empty and stay empty unless he writes them.
