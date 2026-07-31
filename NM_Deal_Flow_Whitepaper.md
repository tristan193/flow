# Nails & Mercy Deal Flow — System Whitepaper

*Version 2026-07-30b. Supersedes `NM_Deal_Flow_Whitepaper.md` (2026-07-30,
no letter suffix) also sitting in this Drive folder — that file describes an
earlier state (no verdict sync, per-instance member toggle) and is stale.
The Drive connector used to build this system has no delete or update tool,
so the old file can't be removed automatically; ignore it or delete it by
hand. If a THIRD version ever appears, trust whichever has the latest date
in the title.*

**For any agent (or human) picking this up cold.** This document explains
what this system is, where every piece of it lives, why it's built the way
it is, and the mistakes already made and fixed so they aren't repeated.

---

## 1. What this is

Nails & Mercy is Tristan and his partner's two-person private equity shop,
doing high-volume SMB lower-mid-market deal sourcing. This system pulls deal
listings from broker emails and marketplace alerts into one deduped database
and a mobile-friendly triage report, so each partner can shortlist/pass/
discuss deals without manually reading fifteen different newsletters a day.

**Each partner reviews from their own Cowork instance, in parallel, not a
shared screen.** As of this version there is no member toggle in the report
— it's hardcoded to one reviewer per build. Verdicts from both partners are
reconciled asynchronously through the Drive sync loop described in §4, not
by sharing a browser session. Only Tristan's instance exists today; his
partner's has not been set up yet (see §7).

**Explicitly out of scope right now:** automated buy-box scoring. A scoring
config (`buybox.yaml`) and engine (`score.py`) exist but are deliberately
parked — Tristan and his partner haven't yet agreed the real criteria against
real deal flow. Do not wire scoring into the live pipeline or the report
artifact until told otherwise.

---

## 2. Where everything lives — read this before touching anything

Three separate storage locations, each with a different job. Confusing these
has already caused a real incident (see §6).

### A. The working folder (source of truth for code + live data)
`C:\Users\tcons\OneDrive\Desktop\NM Deal Flow`

A real, persistent folder on Tristan's machine — connected explicitly via
`mcp__cowork__request_cowork_directory`. It is **not** the same as a chat
session's default scratch/`outputs` directory, which is empty by default in
every new session and does not persist project files. If you're an agent
starting a fresh session (including a scheduled task run) and this folder
isn't already connected, call `request_cowork_directory` with this exact
path before doing anything else.

Contents, grouped by role:

**Pipeline (mail → database):**
- `ingest.py` — the ingestion engine (harvest → route → split → extract →
  dedupe → health). ~1000 lines. Read this fully before changing any
  extraction logic — the regex is defensively written against specific real
  emails that broke earlier, documented inline.
- `db.py` — SQLite schema + idempotent upsert logic, plus the `verdicts`
  table (see §4).
- `populate_real.py` — reference example of running the pipeline against a
  fixed set of real pasted emails. Useful for testing changes to `ingest.py`
  without touching Gmail. Not run on a schedule.
- `daily_run.py` — the script the scheduled harvest actually wrote and ran
  for its first successful live run (2026-07-30), reading real Gmail
  `get_thread` output instead of pasted fixtures. This is a **snapshot of
  one run**, not a maintained entry point — each scheduled run follows
  `populate_real.py`'s pattern fresh rather than re-executing this file
  verbatim, since the set of messages in the 3-day window changes daily.
  Kept for reference on how live Gmail content gets threaded into
  `RawEmail` objects.
- `nm_deals.db` — the live SQLite database, including the `verdicts` table.
  **Important:** this folder is OneDrive-synced. SQLite's file locking does
  not play well with cloud-sync clients — writing to this file in place
  risks corruption. Always copy it down to local disk (e.g. `/tmp`), do all
  writes there, then copy the finished file back over this path as a single
  byte-for-byte write.
- `deals_export.csv` — human-readable export of the db (no locking
  concerns, safe to overwrite directly).
- `buybox.yaml`, `score.py` — parked scoring config/engine. Do not activate.
- `deal-aggregator-blueprint.md` — the original decision document (v2),
  covers ingestion architecture rationale, data model, open questions.

**Report generation (database → artifact) — read this before touching the UI:**
- `artifact_template.html` — **the actual source of the report UI.** Edit
  this file, never `deal-report-v1.html` directly (see below). Contains
  placeholder tokens (`__DEALS__`, `__BAKED__`, `__MEMBER__`, `__BUILD_TS__`,
  `__DRIVE_FOLDER__`, `__DRIVE_CREATE_TOOL__`, `__N_DEALS__`,
  `__PER_SOURCE__`, `__N_NEEDS__`) that `build_artifact.py` fills in at
  build time.
- `build_artifact.py` — reads `nm_deals.db` (deals + verdicts), fills in
  `artifact_template.html`'s placeholders, writes `deal-report-v1.html`.
  Usage: `python3 build_artifact.py --member tristan --db nm_deals.db --out
  deal-report-v1.html` (`--member` picks which partner this build is *for*
  — see §4). **Run this after every db change that should reach the
  report. Never hand-edit the HTML it produces.**
- `deal-report-v1.html` — generated output, gets overwritten every build.
  This is what gets pushed to the live artifact via
  `mcp__cowork__update_artifact`. Kept in the folder for reference/diffing,
  not a thing to edit.
- `deal-report.html` — an older, pre-swipe-mode generated file. Stale,
  harmless, not read by anything.
- `fold_verdicts.py` — reconciles verdict logs from the Drive archive (§4)
  into `nm_deals.db`'s `verdicts` table. Run this **before**
  `build_artifact.py` in any harvest cycle, so the freshly built report
  reflects the latest verdicts from both partners. Idempotent — tracks
  already-processed log filenames in a `verdict_logs_seen` table, safe to
  re-run against the same Drive folder repeatedly.

### B. The live report (what Tristan actually looks at)
Cowork artifact, id `nails-mercy-deal-report`.

A persisted, shareable HTML page (Cowork's artifact system, not a plain
file) with two view modes: a Tinder-style swipe queue (drag or tap to
pass/discuss/save) and a filterable list view.

**Deal data in the artifact is read-only, baked in at build time.** The only
thing the page writes is verdicts, and it writes them outward to Drive, not
back into itself — see §4 for the full loop. Do not add any mechanism that
lets the artifact edit deal data directly.

To refresh the live artifact: run `fold_verdicts.py` then `build_artifact.py`
(§2A), then call `mcp__cowork__update_artifact` with id
`nails-mercy-deal-report` and the freshly generated `deal-report-v1.html`.
Use `list_artifacts` first if you need to confirm the id or inspect current
content.

**Do not change the swipe/list UI structure or CSS on a routine data
refresh** — only regenerate through `build_artifact.py`. If a real UI change
is needed, edit `artifact_template.html`, confirm it still `node --check`s
after extracting the `<script>` block, then rebuild.

### C. The Drive archive (durable backup + verdict inbox, not a live view)
Shared Google Drive folder, id `0AIRHZYgxe1w-Uk9PVA`
(https://drive.google.com/drive/u/0/folders/0AIRHZYgxe1w-Uk9PVA)

This connector (`create_file` etc.) has **no update or delete tool**.
Calling `create_file` with a name that already exists creates a separate
duplicate file — it does not overwrite. Every automated write to this folder
must use a unique filename (dated for CSV snapshots, timestamped for verdict
logs), never a fixed name like `latest.csv`. This folder holds two kinds of
files:

- `nails-mercy-deals-YYYY-MM-DD.csv` — dated daily archive snapshot of the
  full deal export. Growing, append-only, one per harvest day.
- `verdicts-<member>-<ISO-timestamp>.json` — append-only verdict logs
  written directly **by the artifact itself**, from the browser, via
  `window.cowork.callMcpTool`. See §4 for the full mechanics. This folder
  will accumulate many small files over time by design — that's the
  intended shape of an append-only log, not a mess to clean up.
- This document, `NM_Deal_Flow_Whitepaper_<version>.md`.

---

## 3. Architecture — the pipeline

```
tristan@tullyinvesting.com  (deals@ and tw@ aliases both land here)
   │  queried directly by deliveredto: at harvest time — NOT via Gmail
   │  labels/filters, which are unreliable for this purpose
   ├─ 1. HARVEST    Gmail connector, deliveredto:deals@ OR deliveredto:tw@
   ├─ 2. ROUTE      identify source from sender          [ingest.route()]
   ├─ 3. SPLIT      digest email -> N listing blocks      [per-source splitter]
   ├─ 4. EXTRACT    block -> structured fields            [regex, LLM fallback — LLM not yet wired in]
   ├─ 5. DEDUPE     same deal across sources -> one record [3-pass: URL, fingerprint, fuzzy title]
   ├─ 6. PERSIST    upsert into nm_deals.db                [db.upsert()]
   ├─ 7. FOLD       Drive verdict logs -> verdicts table    [fold_verdicts.py]
   ├─ 8. HEALTH     per-source yield vs. baseline          [ingest.health()]
   ├─ 9. SCORE      buy box -> score + rationale           [PARKED — do not activate]
   └─ 10. PUBLISH   rebuild + push the report artifact      [build_artifact.py + mcp__cowork__update_artifact]
```

**Why email, not scraping:** BizBuySell's public listings page returned
decade-stale cached data with no error — the dangerous kind of failure that
looks like success. Every source (BizBuySell BizAlert, Axial, newsletters,
individual brokers) already arrives as email, so email is the only
harvesting method used. No scraping, anywhere, ever, for this project.

**Why regex-first, LLM-second:** money and location decide whether a deal
passes the buy box eventually, and they're exactly the two fields an LLM is
most prone to hallucinate a plausible-but-wrong value for. Regex either
matches or it doesn't. A bare `$395,000` with no nearby label is never
assigned to a field — guessing an unlabeled number into the earnings slot is
how an asking price becomes a phantom good deal.

**Ambiguity is reported, not resolved.** A listing with no disclosed
earnings is tagged `needs_llm: earnings`, not dropped or guessed. When a
business model can't be confidently classified, it returns `AMBIGUOUS` and
routes to human triage — LLM salvage for these cases is designed for but not
yet built.

---

## 4. Verdict sync — how pass/discuss/shortlist gets durable and shared

This is the newest and most failure-prone part of the system; read closely
if you're touching the artifact or the harvest job.

**The problem it solves:** the artifact runs in a browser. Its natural
persistence is `localStorage` — private to one browser, one device, gone if
storage is cleared, invisible to the other partner and to any agent. That
was the state of the system through 2026-07-30 morning: pass/save/discuss
felt permanent but only ever lived in whichever browser tab was open.

**The design — write-only from the browser, read-only in the browser:**

```
 Tristan's browser                Partner's browser (future)
 (local edits, debounced) ─┐                          ┌─ (local edits, debounced)
                            ▼                          ▼
                 Drive folder: verdicts-<member>-<ts>.json   (append-only, never overwritten)
                            │
                            ▼ (next harvest run)
                 fold_verdicts.py → nm_deals.db `verdicts` table
                 (deal_id, member) primary key, last-write-wins by the
                 verdict's own timestamp — NOT upload time
                            │
                            ▼ (next build)
                 build_artifact.py → BAKED constant in both instances'
                 generated HTML → each partner sees the other's calls,
                 including disagreements, as of the last harvest
```

Key properties, all deliberate:

- **The artifact never edits or deletes anything.** It only appends new
  Drive files. This matches the connector's actual capability (§2C) instead
  of fighting it.
- **Cross-partner visibility is next-harvest, not live.** If Tristan passes
  a deal at 2pm and the harvest runs at 6am, his partner won't see that
  verdict until the following morning's rebuild. This is an accepted
  tradeoff, not a bug — flagged explicitly to whoever eventually sets up the
  second instance.
- **Disagreement is preserved, never resolved automatically.** If both
  partners rule on the same deal differently, the list view shows both with
  a `conflict` style. Nothing picks a winner.
- **`local` (this browser, this member, not yet synced) always wins over
  `BAKED` (last harvest's reconciled state) for the current member's own
  verdicts.** Reading your own pending edit takes priority over stale
  server state; reading the *other* member's verdict only ever comes from
  `BAKED`, since a browser has no way to see another browser's live edits.

**Client-side mechanics (in `artifact_template.html`):**
- `MEMBER` is a build-time constant baked in by `build_artifact.py --member
  <name>` — not a runtime toggle. One instance, one reviewer.
- Every verdict action calls `setLocal()`/`clearLocal()`, which updates
  `local` (this member's pending edits) and marks the deal id `dirty`.
- `scheduleFlush()` debounces: 45 seconds of inactivity after the last
  action before a Drive upload fires, so a full swipe session batches into
  one file instead of one file per tap. Chosen deliberately: long enough
  that clicking through to read a listing page doesn't trigger a mid-read
  sync, short enough that closing the laptop soon after finishing a session
  doesn't lose it outright.
- As a safety net independent of the timer, `visibilitychange` (tab
  hidden/backgrounded), `pagehide`, and `beforeunload` all trigger an
  immediate flush if anything is still dirty — covers closing the laptop or
  switching tabs before the debounce would have fired.
- A manual "Sync now" button exists in the status bar but is never
  required — it's a forced early flush, not the only path to Drive.
- The Drive write goes through `window.cowork.callMcpTool(DRIVE_CREATE_TOOL,
  ...)`, where `DRIVE_CREATE_TOOL` is the fully-qualified connector tool
  name baked in at build time by `build_artifact.py`.

**The fragile part — read this before the Drive connector is ever
reconnected or changed:** `DRIVE_CREATE_TOOL` in `build_artifact.py` is a
literal string like `mcp__<connector-instance-uuid>__create_file`. That uuid
is specific to *this* Drive connector session. If the connector is ever
disconnected and reconnected, or a different Google account is linked, that
uuid changes and every existing artifact build (including the live one)
will have verdict sync silently fail — the UI will show "Sync failed,
retrying" but auto-retry with the same wrong tool name forever. **Whoever
reconnects the Drive connector must update `DRIVE_CREATE_TOOL` in
`build_artifact.py` and rebuild.**

**Server-side reconciliation (`fold_verdicts.py`):** downloads every
`verdicts-*.json` in the Drive folder not already recorded in
`verdict_logs_seen`, sorts all events across all files by the verdict's own
`at` timestamp (not upload order — a slow sync from an earlier action could
otherwise clobber a later one), and applies last-write-wins per
`(deal_id, member)`. An `action: null` entry means the reviewer cleared
their verdict — the row is deleted, not nulled. Run it before
`build_artifact.py`, always, or the report will be built from stale
verdicts. It is safe to re-run against the same folder repeatedly.

---

## 5. Data model

Two earnings columns, never collapsed:
```
ebitda  REAL NULL   -- only when the source said EBITDA
sde     REAL NULL   -- SDE, DE, "Cash Flow", "Profit" (bare, unqualified), owner benefit
```
**Rule: ambiguous labels file as SDE, never EBITDA.** BizBuySell's "Cash
Flow" and businessexits.com's bare "Profit" both include owner comp — filing
an ambiguous number as EBITDA overstates the business; filing it as SDE is
the conservative error. Reports read a view that prefers EBITDA and
annotates SDE with `*`.

`source` vs `sub_source`: `source` is the routing bucket that decides which
splitter function runs (`bizbuysell`, `axial`, `businessexits`, `benchmark`,
`newsletter`, etc.). `sub_source` is the actual sender's human-readable
identity within that bucket — critical because `newsletter` alone is a
catch-all covering SMB Deal Hunter, Gulf Coast M&A, and any other one-off
deal newsletter; without `sub_source` there's no way to tell them apart in
the report or health log. `sub_source` (or the bare `source` bucket as
fallback) is what actually renders as the colored source pill in the report
UI.

Dedupe is 3-pass, in order: (1) exact normalized URL match, (2) economic
fingerprint (state + banded revenue + banded earnings), (3) fuzzy title
similarity + same state. Pass 3 exists specifically because a BizAlert
listing starts with zero earnings and gets enriched later by a broker
follow-up — its fingerprint changes entirely once earnings appear, so only
title similarity can bridge the two records into one.

The `verdicts` table (`db.py`): `(deal_id, member)` primary key,
`action` (`short`/`pass`/`discuss`), `reason`, `note`, `created_at`. Fed
exclusively by `fold_verdicts.py` — nothing else should write to it
directly. A `verdict_logs_seen(name, folded_at)` table tracks which Drive
log filenames have already been processed, making the fold idempotent.

---

## 6. Known gotchas — already paid for once, don't re-learn them

- **Cloud-synced folders and SQLite don't mix.** Whether it's a FUSE mount
  or OneDrive, never open `nm_deals.db` for writes at its synced path.
  Always: copy down to local disk → open/write/commit there → copy the
  finished bytes back.
- **Session scratch folders are not shared across sessions.** A scheduled
  task run once found its `outputs` folder completely empty and correctly
  concluded the pipeline files were unreachable — they only ever existed in
  a different chat session's private scratch space. Any automated run must
  explicitly connect the real working folder (§2A) first.
- **The Drive connector cannot overwrite or delete.** Always use unique
  filenames for anything written there — dated for CSV snapshots,
  timestamped for verdict logs.
- **`DRIVE_CREATE_TOOL` in `build_artifact.py` is a connector-session-
  specific string and will silently break verdict sync if the Drive
  connector is ever reconnected without updating it.** See §4.
- **Never hand-edit `deal-report-v1.html`.** It's fully regenerated by
  `build_artifact.py` from `artifact_template.html` every build; direct
  edits are silently discarded on the next run. Edit the template, not the
  output.
- **Always run `fold_verdicts.py` before `build_artifact.py`,** or the
  rebuilt report will be missing recent verdicts from either partner.
- **`extract_money_fields`/`extract_location` are label-anchored and
  proximity-based, not naive first-match.** Several real bugs (revenue vs.
  SDE mis-assignment, newlines silently swallowed between label and value,
  full state names like "Pennsylvania" not being recognized at all) are
  documented inline in `ingest.py` with the exact real email that exposed
  each one. Read those comments before touching the regex.
- **BizBuySell/BizAlert mail carries asking price and location only, never
  financials**, regardless of saved-search criteria. Don't treat a missing
  EBITDA on a BizAlert listing as an extraction failure — it's a real
  absence, correctly flagged `needs_llm: earnings`.

---

## 7. Status as of this writing

Built and working: Gmail harvesting via `deliveredto:` query, real-mail
extraction for BizBuySell/BizAlert, SMB Deal Hunter (digest + single-listing
teaser formats), businessexits.com, Benchmark International, Vanla Group;
3-pass dedupe; SQLite persistence with idempotent upsert; the swipe/list
report artifact (single-member per build); a daily scheduled harvest job
that also folds Drive verdict logs and rebuilds the artifact; a Drive
archive of both CSV snapshots and verdict logs; end-to-end verdict sync
verified with a real 23-deal test session round-tripped through Drive back
into `nm_deals.db`.

Not yet built: **a second Cowork instance for Tristan's partner** — today
only Tristan's `tristan`-member build exists, so the sync loop has never
been exercised with two genuinely different reviewers, only synthetic
test data. Also not yet built: buy-box scoring against real data (Phase 3 —
waiting on Tristan and partner agreeing criteria against real flow, not
synthetic examples), LLM salvage for ambiguous blocks, outreach/CRM tracking
beyond shortlist/pass/discuss, any handling of Axial mail against real
samples (only synthetic Axial fixtures have been tested so far).
