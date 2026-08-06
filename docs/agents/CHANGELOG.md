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

## 2026-08-06 — `nm/web/fit` — DONE

**Scope:** Asking/revenue hard floors when earnings are missing  
**Risk:** low  
**Coords:** none

### Changed
- `pipeline/buybox.yaml` — corridor $700K asking / $700K rev; elsewhere $1.875M asking / $1.5M rev
- `web/lib/fit.ts` — proxy visibility OR-gate; no multiples in runtime
- `pipeline/score.py` — same hard mins
- `web/app/page.tsx` — footer copy

### Follow-ups
- none

## 2026-08-06 — `nm/web/fit` — DONE

**Scope:** Visibility floors — hide far-below-box deals from Review  
**Risk:** low (UI filter; Neon unchanged)  
**Coords:** none

### Changed
- `pipeline/buybox.yaml` — G1 = Austin/SA/Waco corridor; visibility $350K corridor / $750K elsewhere; water keywords; T3 = $350K
- `web/lib/fit.ts` — `surfaced` gate + richer corridor geo matching
- `web/app/page.tsx` / `review-client.tsx` — only surfaced deals in Review
- `pipeline/score.py` — same visibility amounts when scoring rejects

### Follow-ups
- none (rest-of-TX confirmed at $750K national bar)

## 2026-08-06 — `nm/web/review` — DONE

**Scope:** Note after short/discuss is a modal popup, not a persistent field  
**Risk:** low  
**Coords:** none

### Changed
- `web/components/verdict-note.tsx` — full-screen overlay prompt (Skip / Save)
- `web/components/review-client.tsx` / `deal-actions.tsx` — popup on verdict; removed inline note boxes

### Follow-ups
- none

## 2026-08-04 — `nm/web/review` — DONE

**Scope:** Stop labeling BizBuySell cards “no price” when asking exists but earnings don’t  
**Risk:** low  
**Coords:** none

### Changed
- `web/components/deal-card.tsx` — MetricRow shows asking amount when multiple can’t be computed (common after BBS enrich fills revenue without SDE)
- `pipeline/enrich_bizbuysell.py` — map `cashFlow_SDE`; re-enrich candidates missing `asking`

### Follow-ups
- Train AI “price missing” flags on BBS were largely this UI mislabel; clear after Tristan confirms

## 2026-08-04 — `nm/web/review` — DONE

**Scope:** Stop labeling BizBuySell cards “no price” when asking exists but earnings don’t  
**Risk:** low  
**Coords:** none

### Changed
- `web/components/deal-card.tsx` — MetricRow shows asking amount when multiple can’t be computed (common after BBS enrich fills revenue without SDE)
- `pipeline/enrich_bizbuysell.py` — map `cashFlow_SDE`; re-enrich candidates missing `asking`

### Follow-ups
- Train AI “price missing” flags on BBS were largely this UI mislabel; clear after Tristan confirms

## 2026-08-04 — `nm/ingest/repertoire` — DONE

**Scope:** Control stubs so Anthropic receipts + AgencyEquity marketing yield 0  
**Risk:** low  
**Coords:** none

### Changed
- `pipeline/formats/repertoire.yaml` v4 — providers + `anthropic.receipt` / `agencyequity.marketing` (`status: control`, `split: drop`)
- `pipeline/formats/repertoire.meta.json` + `web/lib/repertoire.meta.json` — regenerated for Train AI inspector

### Follow-ups
- Existing junk cards (1763/1764/2434) already in Neon — purge or pass separately; future harvests will not re-ingest

## 2026-08-04 — `nm/web/train` — DONE

**Scope:** Shorter Train AI reason labels / prompts  
**Risk:** low  
**Coords:** none

### Changed
- Listing reasons drop redundant “Wrong …” prefix; prompts **What’s wrong?** / **What don’t you like?**

### Follow-ups
- none

---

## 2026-08-04 — `nm/web/train` — DONE

**Scope:** Hotfix prod 500 — schema indexed `theme` before ALTER added the column  
**Risk:** high (Neon boot / whole app)  
**Coords:** none

### Changed
- `web/db/schema.sql` — `ALTER … theme` / `criteria_intent` before `ix_train_flags_theme`

### Follow-ups
- none

---

## 2026-08-04 — `nm/web/train` — DONE

**Scope:** Train AI themes — listing error vs slim criteria  
**Risk:** medium (schema theme columns; reason vocab change)  
**Coords:** none

### Changed
- Train AI sheet: **Listing error** (6 reasons → repertoire inspect) or **Criteria** (**Should be excluded** / **Request criteria change** with required text)
- `train_flags.theme` + `criteria_intent`; `POST/GET /api/train` groups by theme/intent
- Criteria never auto-edits buy box — agents act only on strong trends / careful exclude misses
- Docs: `docs/deal-format-repertoire.md` §7, `docs/agents/SYSTEM.md`

### Follow-ups
- Old listing reason strings in Neon still display; re-save to use new labels
- Criteria change notes: leave queued until a clear repeating pattern

---

## 2026-08-04 — `nm/web/train` — DONE

**Scope:** Apply open Train AI notes on live Flow App + Rejigg money/title parser  
**Risk:** medium (money extraction; Neon listing patches)  
**Coords:** none

### Changed
- Neon deal **948** (Rejigg): revenue **$50M** (was $15M), title **Oilfield Services Operation** (was digest subject); train flag cleared
- Neon deal **45** (Axial Architectural Sign): revenue **$5.4M** / EBITDA **$1.3M** confirmed; stale train flag cleared
- `pipeline/ingest.py` — `$XM in revenue, $YM in EBITDA` no longer files Y as revenue; digest subjects (`and N other new leads`) no longer steal titles
- `POST /api/deals/correct` — member session can patch listing fields after Train AI review
- Local `nm_deals.db` rows updated to match; shipped `814d33f` + prod deploy

### Follow-ups
- Rejigg multi-deal newsletter still not split into one card per lead — only the oilfield block was corrected
- Separate open flag: deal **1646** AYCE Buffet (not part of this pass)

---

## 2026-08-04 — `nm/bbs/enrich` — DONE

**Scope:** Backfill missing / headline-echo BizBuySell blurbs from Apify listing description  
**Risk:** low (Apify spend only for thin-blurb candidates still eligible)  
**Coords:** none

### Changed
- `pipeline/enrich_bizbuysell.py` — treat empty or title-duplicate blurbs as missing; map `fullDescription`/`shortDescription`; include blurb-only candidates; write when page prose is real

### Follow-ups
- Next daily harvest (or a manual `--newest` enrich) will refill thin blurbs already in the DB

## 2026-08-04 — `nm/web/review` — DONE

**Scope:** Hover affordances on triage buttons + optional notes on short/discuss  
**Risk:** low  
**Coords:** none

### Changed
- `web/components/review-client.tsx` / `deal-actions.tsx` — hover states on ✓ / ? / Pass (and filters)
- `web/components/verdict-note.tsx` — note field after shortlist or discuss; swipe shows post-action prompt
- `web/app/api/verdict/route.ts` + `web/lib/deals.ts` — persist `verdicts.note` (already in schema)

### Follow-ups
- none

## 2026-08-04 — `nm/web/review` — DONE

**Scope:** Green check shortlist button + partner-aware Shortlisted / pass visibility  
**Risk:** low  
**Coords:** none

### Changed
- `web/components/review-client.tsx` — shortlist control is ✓ (green); Shortlisted = either partner `short` or both `discuss`; pass hides from that member’s filters and only resurfaces under Shortlisted if the other partner shorts
- `web/components/deal-actions.tsx` — same ✓ shortlist control on deal detail
- `web/lib/model.ts` — `isTeamShortlist()` helper

### Do not touch
- Pipeline stage promotion still only on `short` (dual discuss does not auto-move the board)

### Follow-ups
- none

## 2026-08-04 — `nm/web/identity` — DONE

**Scope:** Partner display name → Jimmy  
**Risk:** low  
**Coords:** none

### Changed
- `web/lib/model.ts` + `FLOW_MEMBER_PARTNER_LABEL` — UI label **Jimmy** (id stays `partner`)

### Follow-ups
- none

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
