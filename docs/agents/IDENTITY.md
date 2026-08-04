# Agent identity

Every agent working in this repo picks a **stable handle** for the duration of a task (or longer if continuing a workstream).

## Handle format

```text
nm/<domain>/<role>
```

| Part | Values | Examples |
|------|--------|----------|
| `nm` | Fixed prefix | `nm` |
| `domain` | `pipeline` · `web` · `harvest` · `bbs` · `formats` · `ops` · `docs` | `bbs` |
| `role` | Short kebab verb/noun for the job | `enrich`, `flush`, `review-ui` |

**Examples**

| Handle | Use when |
|--------|----------|
| `nm/bbs/enrich` | Apify BizBuySell enrich, harvest wiring for BBS |
| `nm/harvest/gmail` | Gmail OAuth, harvest_gmail, Actions secrets |
| `nm/pipeline/ingest` | Parsers, repertoire, upsert/dedupe |
| `nm/web/review` | Review UI, fit strip, deal cards |
| `nm/ops/flush` | Purge/flush Neon or SQLite inventories |
| `nm/docs/handoff` | This agent-to-agent documentation |

If two agents share a domain, disambiguate: `nm/bbs/enrich-2` or add a date: `nm/bbs/enrich-2026-08-04`.

## How to announce yourself

At the **start** of a multi-step task (or when taking over a workstream), state in chat:

```text
Agent: nm/<domain>/<role>
Scope: <one line>
```

Example: `Agent: nm/bbs/enrich · Scope: wire Apify into daily harvest`

## How to annotate changes

**When:** after work is **tested and landed for production** (committed/pushed to `main`, and Vercel prod deploy if `web/` changed).  
**When not:** during spikes, dry-runs, local-only experiments, or mid-debug. Do not changelog every failed Apify trial.

1. **CHANGELOG.md** — append an entry once the production path is in (required for non-trivial shipped work).
2. **Commits** — first line may stay conventional; body should include:
   ```text
   Agent: nm/<domain>/<role>
   ```
3. **Code comments** — only when the *reason* is non-obvious and durable. Prefer:
   ```python
   # nm/bbs/enrich: Profile/?q= returns empty on Apify; use /business-opportunity/{slug}/{id}/
   ```
   Do not stamp every line with an agent id.

If you ship in several commits, one CHANGELOG entry covering the whole change set is enough (link the merge/push or key commit).

## Coordination

- If another agent’s CHANGELOG entry says **IN PROGRESS** on a path you need, **stop and ask Tristan** (or wait) unless he already assigned you that path.
- Do not revert another agent’s uncommitted work without explicit instruction.
- Secrets and live Neon flushes are high-blast-radius — call them out in CHANGELOG under **Risk**.
