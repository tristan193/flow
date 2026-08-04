# Agent changelog

Append **newest entries at the top**. Follow [IDENTITY.md](./IDENTITY.md).

**Update this file only after a change is tested and implemented for production** (on `main`, live harvest/app as applicable). Skip entries for pure experiments, dry-runs, and WIP that never shipped.

## Entry template

```markdown
## YYYY-MM-DD — `nm/<domain>/<role>` — STATUS

**Scope:** …
**Risk:** low | medium | high (Neon/flush/secrets = high)
**Coords:** none | blocked on `nm/...` | coordinating with …

### Changed
- `path` — what / why

### Do not touch
- …

### Follow-ups
- …
```

STATUS: `IN PROGRESS` | `DONE` | `BLOCKED` | `HANDED OFF`

---

## 2026-08-04 — `nm/web/review` — DONE

**Scope:** Train AI mobile usability + session skip on swipe cards  
**Risk:** low  
**Coords:** none

### Changed
- `web/components/train-ai-button.tsx` — Train AI opens as a scrollable bottom-sheet / modal (portal), not inline in the height-locked card
- `web/components/review-client.tsx` — small **Skip** on the card + **Skip deal** under the deck; session-only (no verdict); Undo restores

### Follow-ups
- none

---

## 2026-08-04 — `nm/docs/handoff` — DONE

**Scope:** Agent-to-agent docs + identity/changelog; changelog only after production ship  
**Risk:** low  
**Coords:** none

### Changed
- `docs/agents/*` — SYSTEM, IDENTITY, CHANGELOG, README
- `.cursor/rules/agent-to-agent.mdc` — always-apply; update CHANGELOG after prod, not during tests
- `README.md` — harvest diagram includes Apify enrich + agents link

### Follow-ups
- Other agents: pick a handle; log here only when work is live on `main`

---

## 2026-08-04 — `nm/bbs/enrich` — DONE

**Scope:** BizBuySell listing enrich via Apify as **required** harvest step; buy-box headline skip  
**Risk:** medium (spend Apify credits; harvest fails without `APIFY_TOKEN`)  
**Coords:** Do not fight concurrent BBS flush/purge agents

### Changed
- `pipeline/enrich_bizbuysell.py` — Apify actor `abotapi~bizbuysell-scraper`; slug URLs; buy-box skip; DB fill
- `pipeline/run_daily_harvest.sh` — enrich after ingest; FATAL without `APIFY_TOKEN`
- `.github/workflows/daily-harvest.yml` — `APIFY_TOKEN`, `BBS_ENRICH_LIMIT=120`, 60m timeout
- `pipeline/credentials/README.md` — `apify_token.txt` note

### Proven in prod harvest
- Run https://github.com/tristan193/flow/actions/runs/30872982350  
  candidates 94, buybox_skip 17, ok 91, with_earnings 85, pushed to Flow App

### Do not touch / do not regress
- Do **not** switch default fetch back to `Profile/?q=` or generic Playwright scraper (Akamai / empty dataset)
- Do **not** make Apify optional in harvest without Tristan’s OK
- Leave other agents’ flush/purge paths alone while marked IN PROGRESS

### Follow-ups
- Consider stripping `j`/`bn`/`bd` in `norm_url` for cleaner stored BBS URLs
- Watch Anthropic/receipt false-positive ingest
- README root architecture diagram still shows pre-Apify harvest (optional doc sync)

---

## 2026-08-03..04 — `nm/ops/flush` (other agent) — COORDINATE

**Scope:** Purge broad/old BizBuySell inventory (Tristan-directed)  
**Risk:** high  
**Coords:** If IN PROGRESS, other agents must not rewrite `nm_deals.db` / Neon flush mid-flight

### Surfaces (may be local/uncommitted — check git status)
- `.github/workflows/purge-bizbuysell.yml` (if present)
- `web/app/api/import/flush/route.ts` (if modified)

### Note
`nm/bbs/enrich` restored a wiped local SQLite from Temp backup during testing; CI artifact + Neon are sources of truth for live data after harvest.
