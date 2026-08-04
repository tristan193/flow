# Agent-to-agent handoff (NM Deal Flow)

**Read this before changing harvest, BizBuySell, ingest, or Flow App import.**

Companion files:

| File | Purpose |
|------|---------|
| [SYSTEM.md](./SYSTEM.md) | How the product works end-to-end |
| [CHANGELOG.md](./CHANGELOG.md) | Who changed what (required annotations) |
| [IDENTITY.md](./IDENTITY.md) | How agents name themselves |

Owner: Tristan. Live app: https://web-tau-seven-77.vercel.app  
Repo: `tristan193/flow` · default branch `main`.

## Hard rules (all agents)

1. **Ship fully** when Tristan wants something live: commit → push `main` → if `web/` changed, `npx vercel --prod` from `web/`. See `.cursor/rules/ship-fully.mdc`.
2. **Do not commit secrets**: `.env*`, `pipeline/credentials/*` (except README), `apify_token.txt`, OAuth JSON.
3. **Do not fight another agent’s in-progress flush/purge.** If Tristan says another agent owns a flush, leave `nm_deals.db`, flush routes, and purge workflows alone until clear.
4. **Identify yourself** (see IDENTITY.md). **Update CHANGELOG.md after** work is tested and shipped to production — not during local spikes or dry-runs.
5. Prefer the smallest diff that matches existing patterns; no drive-by refactors.

## Quick map

```
Gmail (dirk@)
  → GitHub Actions daily-harvest.yml
  → harvest_gmail.py + ingest.py
  → enrich_bizbuysell.py (Apify)   ← required for BizBuySell money fields
  → export_snapshot.py --post
  → Flow App /api/import (Neon)
```

Local dummy app: empty `DATABASE_URL` → in-memory PGlite seeded from `web/db/seed-data.json`.
