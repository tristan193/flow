# Deal Extraction & Format Repertoire — Agent Whitepaper

**For any agent (or human) picking up extraction / source-attribution work cold.**
Last updated: 2026-08-01

This is the handoff doc for the **email → structured deal** workstream. It does
not replace the system overview; it records *intent*, *what we learned from
live mail*, *contracts you must not break*, and *where the truth lives*.

---

## 1. Project intent (why this workstream exists)

Nails & Mercy sources SMB / lower-mid-market deals from broker and marketplace
**email**, not scrapers. The Python pipeline owns extraction; Flow App only
reviews and pipelines what was imported.

**Problem we set out to fix:** extraction quality varies wildly by sender.
“Unrecognized” inbox mail was not mostly spam — it was **real deal formats we
had never catalogued**. Agents and humans were encoding format knowledge as
tribal regex comments inside `ingest.py`.

**Intent of this workstream:**

1. Build an explicit **format repertoire** keyed by how mail actually arrives
   (sender address, subject shape, how the body opens) — not by hope.
2. Treat **email type** as the first classification step after attribution:
   digest vs single listing vs marketing vs follow-up vs account notice.
3. Lock an **attribution triad** so domain, mailbox, and display label are
   never collapsed into one overloaded `source` field again.
4. Remodel the existing regex-first pipeline — **do not rewrite**. Money and
   location stay deterministic; LLM salvage stays reserved for gaps.

**Non-goals (still parked):** buy-box scoring wired into the live path; LLM
extraction of asking/EBITDA; scraping BizBuySell HTML.

---

## 2. Live architecture (current truth)

```
Brokers / marketplaces → dirk@tullyinvesting.com
        ↓
Vercel Cron → /api/cron/harvest → GitHub Actions
        ↓
harvest_gmail.py → ingest.py → nm_deals.db
        ↓
export_snapshot.py --post → Flow App /api/import
        ↓
Neon Postgres → https://web-tau-seven-77.vercel.app
```

| Fact | Detail |
|------|--------|
| Catcher inbox | `dirk@tullyinvesting.com` (Gmail API Path B — OAuth token in Actions secrets) |
| Flow App | Next.js on Vercel project `web` (Hobby) |
| Hosted DB | Neon via `DATABASE_URL` |
| GitHub | `https://github.com/tristan193/flow` |
| Deploy model | **CLI `vercel deploy --prod`**, not Git auto-deploy — pushing `main` alone does **not** update production |

Gmail *chat connectors* (Cursor MCP) cannot run the scheduled pipeline. Ops
setup: [`pipeline/GMAIL_SETUP.md`](../pipeline/GMAIL_SETUP.md) and
[`docs/Google_Workspace_Cursor_Whitepaper.md`](./Google_Workspace_Cursor_Whitepaper.md).

---

## 3. Attribution triad (organizational contract)

**Keep these three field names and meanings everywhere** — pipeline `Listing`,
SQLite, Neon, import JSON, Flow App UI, repertoire YAML:

| Field | Meaning | Example |
|-------|---------|---------|
| **`source`** | Sender **domain** | `bizbuysell.com` |
| **`sub_source`** | Sender **email address** | `bizalert@bizbuysell.com` |
| **`nickname`** | Human-facing label (pill text) | `BizBuySell` |

UI may truncate for display; storage keeps full values. Automated deal mail
comes from fixed inboxes — **`sub_source` is one of the strongest format
signals** (same domain, different products).

**Internal only — not a stored “source”:**

| Concept | Role | Example |
|---------|------|---------|
| **`format_family`** | Picks splitter, health baseline, `ext_id` prefix | `bizbuysell`, `axial`, `newsletter` |

Never put `format_family` back into the `source` column. That mix-up is what
made `bizalert@` and `newbizopps@` look identical.

Implementation: `attribution()` + `format_family()` in `pipeline/ingest.py`.

---

## 4. Format repertoire — what it is

A living catalog of expected email shapes. Detection order (always):

1. **`sub_source` / `source`** (address, then domain)
2. **Subject line shape**
3. **How the email opens** (~first meaningful lines after `strip_html`)
4. **Body markers** (confirmation / last resort)

**Email types:**

| Type | Meaning |
|------|---------|
| `daily_digest` | Multi-listing alert / numbered issue |
| `single_listing` | One deal per email |
| `newsletter_marketing` | Editorial / marketing — expected yield 0 |
| `follow_up` | NDA / buyer-profile / CIM thread |
| `account_notice` | Transactional — expected yield 0 |

**Machine catalog:** `pipeline/formats/repertoire.yaml`  
**Human contract:** `docs/deal-format-repertoire.md`  
**Rule:** do not add a new regex path in `ingest.py` without a repertoire `id`.

---

## 5. Findings from the live 5-day inbox survey

**Survey:** 2026-08-02 · 61 messages ·  
`newer_than:5d deliveredto:dirk@tullyinvesting.com in:anywhere`  
Artifacts: `pipeline/formats/survey/inbox_5d.json` (+ bodies locally, gitignored)

| Count | Shape | Yield under then-current splitter |
|------:|-------|-----------------------------------|
| **35** | `newbizopps@bizbuysell.com` — subject `Business For Sale: …` | **0 — parser gap** |
| **9** | `bizalert@bizbuysell.com` — `N New Business Match(es): …` | Working |
| **4** | `newdeal@axial.net` — one opportunity / email | Working; LTM money often wrong |
| **2** | `notifications@axial.net` — Action Summary | 0 (correct) |
| **1+** | SMB Deal Hunter digest vs editorial | Digest works; editorial must stay 0 |
| **1** | Benchmark follow-up (`benchmarkintl.com`) | False-positive junk risk |
| **1** | Gateway subscription confirm | 0 (correct) |

**Headline finding:** ~35/42 zero-yield messages were **BizBuySell single-listing
alerts from `newbizopps@`**, not unrecognized noise.

### BizBuySell — two products, two senders

| Product | sub_source | Type | Notes |
|---------|------------|------|-------|
| BizAlert digest | `bizalert@bizbuysell.com` | `daily_digest` | Uses `Location:` label. Live From is **`bizalert@`**, not fixture `alerts@`. Asking + location only — missing earnings is normal. |
| New business opps | `newbizopps@bizbuysell.com` | `single_listing` | Subject `Business For Sale: {Category} in {Geo}`. Location is a **`City, ST (…):` link line**, never `Location:`. Current `BIZALERT_LISTING` regex requires `Location:` → **0 yield**. Status in repertoire: **`needs_parser`**. |

### Other lessons

- Same Axial domain ships **deal teasers** (`newdeal@`) and **controls**
  (`notifications@` Action Summary / account notices) — type detection is
  mandatory.
- SMB Deal Hunter: same `helen@mail.smbdealhunter.xyz` for digests
  (`In Today's Issue`) and editorial/podcast mail — body open decides type.
- Forwarded mail: never attribute `tullyinvesting.com` / Gmail; peel
  `Forwarded message` and use original From.
- Extraction design remains **regex-first for money/location** (no bare `$`
  assignment; ambiguous labels → SDE). LLM salvage still unwired.

---

## 6. What we changed in code / ops (this workstream)

| Change | Where |
|--------|--------|
| Attribution triad on `Listing` + `attribution()` | `pipeline/ingest.py` |
| SQLite `source` / `nickname` + migrate | `pipeline/db.py` |
| Export / import emit and upsert triad | `export_snapshot.py`, `web/lib/import.ts` |
| Neon columns + ALTER IF NOT EXISTS | `web/db/schema.sql` |
| UI pill = nickname; detail shows email + domain | `deal-card.tsx`, `deals/[id]/page.tsx` |
| Format repertoire + survey tooling | `pipeline/formats/`, `survey_inbox.py` |
| Docs updated for triad | README, NM whitepaper, blueprint, repertoire md |

**Deploy gotcha (already hit in production):** after adding columns to `deals`,
`CREATE OR REPLACE VIEW v_deals AS SELECT d.*, …` fails with  
`cannot change name of view column "earnings" to "source"` (Postgres 42P16).
**Fix:** `DROP VIEW IF EXISTS v_deals;` then `CREATE VIEW …` (in `schema.sql`).
If the app shows “This page couldn’t load”, check Vercel logs for that error
and ensure the DROP VIEW fix is deployed via **`npx vercel --prod`** from `web/`.

**Git vs Vercel:** commits on `main` do not auto-deploy. Production updates
require an explicit CLI deploy (project history shows `vercel deploy` authors).

---

## 7. Document map (read in this order)

| Doc | Use when |
|-----|----------|
| **This whitepaper** | Cold start on extraction / repertoire / attribution |
| [`deal-format-repertoire.md`](./deal-format-repertoire.md) | Adding or changing a format; detection contract |
| [`pipeline/formats/repertoire.yaml`](../pipeline/formats/repertoire.yaml) | Machine-readable format ids + detect patterns |
| [`pipeline/formats/survey/inbox_5d.json`](../pipeline/formats/survey/inbox_5d.json) | Evidence for what the inbox actually contains |
| [`README.md`](../README.md) | Live path + triad one-pager |
| [`pipeline/GMAIL_SETUP.md`](../pipeline/GMAIL_SETUP.md) | Harvest credentials / Actions / cron |
| [`Google_Workspace_Cursor_Whitepaper.md`](./Google_Workspace_Cursor_Whitepaper.md) | Gmail Path A vs Path B (connectors vs service token) |
| [`NM_Deal_Flow_Whitepaper.md`](./NM_Deal_Flow_Whitepaper.md) | Broader system history — **partially stale** on delivery (Cowork/Drive); trust README + this doc for live path |
| [`deal-aggregator-blueprint.md`](./deal-aggregator-blueprint.md) | Original product decisions (email-as-bus, regex-first) |

---

## 8. Open work (next agents)

Ordered by leverage:

1. **Implement `bizbuysell.newbizopps_single` splitter/extractor**  
   Location from `City, ST…:` link line; title from headline URL line; asking
   from `Asking Price:`. Promotes repertoire status `needs_parser` → `active`.
   Recovers ~35 deals / 5-day window.

2. **Confirm production health** after any schema change  
   Deploy with `cd web && npx vercel --prod`. Reload app so Neon applies
   `ALTER` + view recreate. Re-run harvest so rows get domain/email/nickname
   (old `sub_source` values may still be nicknames until re-import).

3. **Axial LTM money parsing**  
   Revenue/EBITDA often arrive as separate lines (`Revenue` / `$7.6` / `M`).
   Current extract can latch onto prose ranges instead.

4. **Wire email-type classifier from repertoire YAML**  
   Today type is still mostly implicit in splitter choice; promote
   `email_type` + `format_id` onto the ingest path.

5. **LLM salvage for `needs_llm` only** — still constrained by repertoire
   (e.g. BizAlert never invents EBITDA).

6. **Do not** invent unlabeled money; **do not** treat missing BizAlert
   earnings as a parse failure; **do not** attribute forwarder domains.

---

## 9. Agent checklist before changing extraction

- [ ] Read this whitepaper + `deal-format-repertoire.md`
- [ ] Confirm attribution triad field meanings (domain / email / nickname)
- [ ] Add or update a `repertoire.yaml` `id` before new regex
- [ ] Prefer a real survey body under `pipeline/formats/survey/bodies/` (local)
      or re-run `python pipeline/survey_inbox.py --days 5`
- [ ] Keep money/location regex-first
- [ ] If touching `schema.sql` views: DROP + CREATE, not blind OR REPLACE after
      column inserts
- [ ] Remember: GitHub push ≠ Vercel production; deploy explicitly

---

*End of handoff. Prefer remodeling `ingest.py` with repertoire entries over a
greenfield LLM extractor.*
