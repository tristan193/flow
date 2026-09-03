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

## 2026-09-03 — `nm/web/cim-headline` — DONE

**Scope:** Tristan / Jim `notes_next` on CIM-stage cards only; Simon never rendered
**Risk:** low (read-only card display + existing notes API; no schema change)
**Coords:** none — follows the `cim_name` headline ship

### Changed
- `cimStagePartnerNotes()` — empty unless `stage === cim`; `partnerNotesOnly` drops Simon
- `CimPartnerNotes` on CIM Review and `/next` CIM board cards (hidden when empty)
- `/next/deals/[id]` notes composer/list only at CIM

### Do not touch
- New / Shortlist / NDA note sections (stay hidden)
- Simon votes
- Drive / GCP on Vercel

### Follow-ups
- none

## 2026-09-03 — `nm/web/cim-headline` — DONE

**Scope:** Dedicated `deals_next.cim_name` for Simon’s CIM company/project/nickname; cards swap it in as the headline and keep teaser `title` as the quieter subline
**Risk:** low (nullable column + display helper; intake still updates one TLY row; no Drive/GCP; no votes)
**Coords:** none

### Changed
- `web/db/schema.sql` — `deals_next.cim_name TEXT` (ALTER IF NOT EXISTS)
- `POST /api/next/cim-intake` — JSON key **`cimName`** (aliases `cim_name`, `companyName`, `company_name`, `headline`) writes `cim_name`; teaser `title` is never overwritten; both names fold into `alias_names`
- `pipeline/cim_intake.py` — `--cim-name`
- `DealTitleStack` — New Review, CIM Review, `/next` board, deal detail show headline + subline
- README / SYSTEM — Simon contract

### Do not touch
- PR #12 Drive folder create / googleapis-on-Vercel
- Simon votes
- Classic `/` Review

### Follow-ups
- Simon includes `cimName` on each intake POST going forward

## 2026-09-03 — `nm/web/gmail-authuser` — DONE

**Scope:** Every Gmail deep link Tristan sees in Flow forces `dirk@tullyinvesting.com` (never `/mail/u/0`)
**Risk:** low (href rewrite + read-path normalize; no new secrets)
**Coords:** none

### Changed
- `web/lib/gmail-thread.ts` — shared canonical helper; `gmailAllHref` is the same function
- `web/lib/next/identity.ts` — Next/Dirk no longer emit `/mail/u/0`
- `web/lib/deals.ts` / `expectations.ts` / `crm-pursuit.ts` — rewrite stored `gmail_thread_url` on read
- `web/lib/boot.ts` — one-time backfill of legacy stored URLs
- `pipeline/crm_pursuit.py` — `gmail_catcher_thread_url()` matches the TS helper

### Do not touch
- CIM intake contract
- Drive / GCP on Vercel
- Vote / stage combine rules

### Follow-ups
- none

## 2026-09-03 — `nm/web/cim-intake` — DONE

**Scope:** Token POST `/api/next/cim-intake` stamps Drive file URL + optional pack numbers + stage CIM on the existing TLY `deals_next` row; CIM Review lists every stage CIM card
**Risk:** medium (writes `cim_url` / financials / `stage` on `deals_next`; never inserts a deal or vote)
**Coords:** none — did not merge PR #12; no GCP/Drive auth on Vercel

### Changed
- `POST /api/next/cim-intake` — `FLOW_IMPORT_TOKEN` only; body `{ fileName, cimUrl, dealNumber?, revenue?, ebitda?, margin?, asking? }`; TLY from filename; posted dealNumber must match; one transaction
- `web/middleware.ts` — allowlist `/api/next/cim-intake`
- `listNextCimDeals()` / `isNextCimReviewCard` — every stage CIM row (plus open-board rows with a stamped file URL)
- `pipeline/cim_intake.py` — Simon CLI (token from env; one POST)

### Do not touch
- PR #12 Drive folder create / googleapis-on-Vercel
- Per-deal folders
- New inbound swipe / FitStrip
- Classic `/` Review

### Follow-ups
- Simon POSTs after each `TLY-XXX Headline.pdf` lands in the shared Drive parent

## 2026-09-03 — `nm/web/review-cim-fix` — DONE

**Scope:** Middleware allowlist for token POST `/api/next/cim-financials` (was 307 to /login)
**Risk:** low (same family as `/api/next/cim-url`; route still requires FLOW_IMPORT_TOKEN)
**Coords:** none

### Changed
- `web/middleware.ts` — add `/api/next/cim-financials` to `PUBLIC_PATHS` so a Bearer token is not bounced to login

### Do not touch
- Review UI
- Pipeline stages
- The route’s token check

### Follow-ups
- Dirk stamps TLY-092 / TLY-031 pack numbers

## 2026-09-03 — `nm/web/review-cim-fix` — DONE

**Scope:** CIM Review cards show pack numbers; Dirk token-stamps them by TLY; no stage moves
**Risk:** medium (writes `deals_next.revenue` / `ebitda` / `asking` / `margin`; never `stage`)
**Coords:** none — did not merge PR #12; did not reset CIM/Pursuing

### Changed
- `web/components/next/cim-review-client.tsx` — CIM card: no teaser FitStrip (Priority / No financials); Super Like **star**; pack metrics revenue / EBITDA / margin / asking (omit missing); **View CIM** new tab; no notes UI
- `POST /api/next/cim-financials` — `FLOW_IMPORT_TOKEN` only; body `{ dealNumber, revenue?, ebitda?, margin?, asking? }`; COALESCE unspecified; never writes stage
- `web/db/schema.sql` — stored `deals_next.margin` (ratio); `v_deals_next` no longer computes a duplicate `margin` column
- New Review stays swipe-only; CIM deck still requires stamped `cim_url` (TLY-001 off the deck)

### Do not touch
- PR #12 Drive folder create / googleapis-on-Vercel
- Pipeline stages / CIM→NDA reset (cancelled)
- New inbound FitStrip / List (there is no List)
- Classic `/` Review

### Follow-ups
- none

## 2026-09-03 — `nm/web/review-cim` — DONE

**Scope:** `/next` Review New | CIM modes; dual-agree CIM votes; no Drive writes
**Risk:** medium (`cim_verdicts_next` + CIM stage combine)
**Coords:** none — did not merge PR #12; reused vote/UI only

### Changed
- `web/app/next/page.tsx` + `review-client.tsx` — logged-in Review shows **New | CIM**
- `web/lib/next/model.ts` `combineNextCim` — both Pass → Closed; both Pursue → Pursuing; Hold/mixed/one vote stay CIM
- `web/lib/next/deals.ts` — `listNextCimDeals()` is stamped `cim_url` and/or stage CIM; Simon rows are dropped
- `web/app/api/next/cim/verdict` — Tristan/Jim session votes only
- CIM pack control → existing `/cim/TLY-XXX`

### Do not touch
- PR #12 Drive folder create / googleapis-on-the-client
- `POST /api/next/cim-url` token stamp (already live)
- Pipeline `/next` board (still SL / NDA / CIM / Pursuing)
- New inbound combine (Like / Super Like / both `?`)

### Follow-ups
- none

## 2026-09-03 — `nm/web/cim-stamp` — DONE

**Scope:** `/cim/TLY-XXX` redirects from a stamped Drive file URL; Dirk token-stamps `cimUrl`; no Google on Vercel
**Risk:** low (nullable `cim_url` already on `deals_next`; token-only write; no Drive API)
**Coords:** none — did **not** merge PR #12

### Changed
- `web/app/cim/[id]/page.tsx` + `web/lib/cim-open.ts` — look up deal by TLY; redirect to stored Drive file URL; missing → “CIM not in yet”; never “Drive is not connected”
- `POST /api/next/cim-url` — `FLOW_IMPORT_TOKEN` only; body `{ dealNumber, cimUrl }` (file URL, not a folder)
- `web/db/schema.sql` — `ALTER TABLE deals_next ADD COLUMN IF NOT EXISTS cim_url TEXT`
- `/next` cards still link to `/cim/TLY-XXX`

### Do not touch
- PR #12 folder-create / Shortlist Drive write
- `GOOGLE_SERVICE_ACCOUNT_JSON` (not required for this path)
- Classic `/` Review, `/api/cim/extract`

### Follow-ups
- Dirk lists Shared Drive `0ABYzLaaJ9ebAUk9PVA`, matches `TLY-XXX Headline.pdf`, POSTs the file URL

## 2026-09-03 — `nm/web/cim-open` — DONE

**Scope:** Thin CIM pack opener — `/cim/TLY-XXX` lists the shared Drive parent and redirects to the matching PDF
**Risk:** low (read/list only; no Drive writes; no folder create)
**Coords:** none — new branch off `main`; did **not** continue or merge PR #12

### Changed
- `web/app/cim/[id]/page.tsx` — one dynamic route; normalize case; require `TLY-\d+`
- `web/lib/cim-pack.ts` — Shared Drive list (`corpora=drive`, `driveId=0ABYzLaaJ9ebAUk9PVA`); prefix match; newest PDF; never `files.create`
- `web/components/next/deal-card.tsx` + `review-client.tsx` — tiny CIM link on `/next` cards
- Env: `GOOGLE_SERVICE_ACCOUNT_JSON` (readonly). Invite the service account to Shared Drive `0ABYzLaaJ9ebAUk9PVA` as Viewer

### Do not touch
- PR #12 folder-create / Shortlist Drive write / 6am folder attach / Review New+CIM rewrite
- Classic `/` Review, `/api/cim/extract`, `/api/next/cim/create`

### Follow-ups
- Dirk: share the Shared Drive with the service account `client_email` as Viewer (or Content Manager)
- Confirm `GOOGLE_SERVICE_ACCOUNT_JSON` is set on Vercel project `web` (team `nm-c283`) production

## 2026-09-03 — `nm/web/review-parallel` — DONE

**Scope:** Parallel `/next` Review decks for Tristan and Jim Evans; combine rules on one shared board
**Risk:** medium (`verdicts_next` combine; inbound Pass no longer auto-closes)
**Coords:** none — merged #11 onto `main` after #9 Super Like and #10 ✓✓✓-right

### Changed
- `web/lib/next/model.ts` `combineNextReview` — either Like or Super Like → Shortlisted; both `?` → Shortlisted; both finished otherwise → Closed; one Pass/`?` stays inbox
- `web/lib/next/deals.ts` + import verdicts — `setNextVerdict` / Super Like apply combine; a single Pass does not archive
- `web/lib/model.ts` — partner label default **Jim Evans** (id stays `partner`); same `/login` passcodes
- `web/app/login/login-form.tsx` + `middleware.ts` — default landing `/next`
- Swipe row stays **✕ · ? · ✓ · ✓✓✓** (Super Like rightmost, from #10)

### Do not touch
- Classic `/` Review (`deals` table)
- Dirk later-stage moves via `POST /api/next/stage`
- Super Like pin behavior (clears on Pass / Pursue / Closed)

### Follow-ups
- If prod still has `FLOW_MEMBER_PARTNER_LABEL=Jimmy`, set it to `Jim Evans` (id unchanged)

## 2026-09-02 — `nm/web/tly-match` — DONE

**Scope:** `/next` Review swipe inbound-only; CIM add lands on `/next` at CIM; stop minting Axial twins
**Risk:** medium (Review queue filter; `deals_next` CIM insert; merge of raced TLY-023..029)
**Coords:** none

### Changed
- `web/app/next/page.tsx` + `listNextInboxDeals()` — Review loads stage `inbox` only. Pursuing TLY-074 / Closed CIM cards no longer return as PRIORITY.
- `web/components/next/review-client.tsx` — swipe/todo also require inbound (defense in depth).
- `web/lib/next/cim-create.ts` + `POST /api/next/cim/create` — Add from CIM on `/next/pipeline` joins existing TLY then sets CIM; new cards skip inbound.
- `web/lib/next/import.ts` — return `dealIds`; lock fingerprint together with source id.

### Do not touch
- Classic `/` and `/pipeline` CIM create (`deals` table)
- Live harvest → `/api/import`
- TLY-074 / TLY-077 (not twins; already one TLY each)

### Follow-ups
- After deploy: `POST /api/next/merge` `{ "confirm": "MERGE", "deleteDealNumbers": ["TLY-023","TLY-024","TLY-025","TLY-026","TLY-027","TLY-028","TLY-029"] }` to collapse 9/1 concurrent Axial twins, then unique `source_deal_id` index can apply.

## 2026-09-02 — `nm/web/next-pipeline` — DONE

**Scope:** Collapse `/next` Pipeline to five stages; stack TLY + listing IDs under the company name  
**Risk:** medium (boot SQL remaps `deals_next.stage`; Dirk aliases invert from old→new)  
**Coords:** none — PRs #4 and #6 were still open; this lands both on current `main` (post Dirk token control plane)

### Changed
- `web/lib/next/stages.ts` — board is Shortlisted → NDA → CIM → Pursuing → Closed. `pof`/`nda_to_sign`/`nda` → NDA; `awaiting_reply`/`active` → Pursuing; `dead` → Closed. No new stages.
- `web/db/schema.sql` — boot remap so leftover rows do not vanish
- `web/components/next/deal-card.tsx` — company name on top; TLY and listing IDs stacked underneath
- `web/components/next/pipeline-board.tsx` — five chips only; canned POF / NDA TO SIGN / AWAITING REPLY / ACTIVE REVIEW gone

### Do not touch
- Classic `/` and `/pipeline` (`web/lib/model.ts` `STAGES`)
- Live `deals` table / `/api/import`
- Harvest clocks

### Follow-ups
- Close or supercede open PRs #4 and #6 after this is on production

---

## 2026-09-01 — `nm/web/next-ingest` — DONE

**Scope:** Dirk token control plane for `/next` stages; ingest race + duplicate merge  
**Risk:** medium (Neon `deals_next` unique index after merge; stage moves)  
**Coords:** none — did not merge PR #1 or PR #6; harvest clocks untouched

### Changed
- `web/app/api/next/stage/route.ts` — Bearer `FLOW_IMPORT_TOKEN` or member session; `dealNumber` or `dealId` + `stage`
- `web/lib/next/stage-auth.ts` — 401 / 400 / 404; aliases `closed|pass|passed` → `dead`, `pursuing` → `awaiting_reply`
- `web/lib/next/import.ts` — transactional match+insert; import `stage`/`proposedStage` via `moveNextStage` (`dirk`); pass/short verdicts move inbox
- `web/app/api/next/merge/route.ts` — token collapse of duplicate TLY rows
- `web/middleware.ts` — `/api/next/stage` and `/api/next/merge` token-reachable

### Do not touch
- Classic `/` and `/pipeline`
- Live `deals` table / `/api/import`
- Login passcodes
- Harvest clocks

### Follow-ups
- After deploy: `POST /api/next/merge` `{ "confirm": "MERGE" }` to collapse TLY-023..029
- Dirk: `POST /api/next/stage` `{ "dealNumber": "TLY-002", "stage": "dead" }` with import token

---

## 2026-08-27 — `nm/web/crm` — DONE

**Scope:** Dismiss button on Inbox watches (armed expectations)  
**Risk:** low  
**Coords:** none

### Changed
- `web/lib/expectations.ts` — `cancelExpectation(id)`
- `web/app/api/crm/attention/route.ts` — dismiss via `expectationId`
- `web/components/attention-panel.tsx` — Dismiss on watch cards (reviews already had it)

### Follow-ups
- none

## 2026-08-25 — `nm/web/cim-web` — DONE

**Scope:** Web CIM — broker landing page (+ optional access/password note) alongside file upload  
**Risk:** low (new nullable column; UI + `/api/cim/link`)  
**Coords:** none

### Changed
- `web/db/schema.sql` — `cim_access_note`
- `web/lib/cim-url.ts`, `web/lib/deals.ts` — `saveDealCimLink` / file vs web helpers
- `web/app/api/cim/link/route.ts` — save Web CIM
- `web/components/attach-cim.tsx`, `action-deck.tsx` — File CIM + Web CIM

### Follow-ups
- Access note is partner-visible plain text (not a secrets vault)

---

## 2026-08-25 — `nm/web/crm-pursuit` — DONE

**Scope:** Inbox watches open Dirk Gmail on click (not Tristan default)  
**Risk:** low  
**Coords:** none

### Changed
- `web/lib/gmail-thread.ts` — `dirkMailHref` / search-by-title when no thread yet
- `web/components/attention-panel.tsx` — title + **Open in Dirk** → `authuser=dirk@`
- `web/lib/expectations.ts`, `web/lib/crm-pursuit.ts` — pass `gmail_thread_url` / `nda_url` into panel

### Follow-ups
- Browser must already be signed into `dirk@` for authuser to stick

---

## 2026-08-25 — `nm/web/crm-pursuit` — DONE

**Scope:** Whole-pipeline pursuit loop — Act arms expectations; inbox hard-match; agentic review  
**Risk:** medium (new table, match policy change, Act CTA priority)  
**Coords:** none

### Changed
- `web/db/schema.sql` — `deal_expectations` (open watches after Act/debrief)
- `web/lib/expectations.ts` — arm/fulfill from outreach outcomes
- `web/lib/crm-pursuit.ts` — auto-apply only listing-id / verbatim title; fuzzy → `needs_review`
- `web/lib/playbooks.ts` — non-Axial: Sign NDA / Open in Dirk before listing bookmark
- `AttentionPanel` + `GET/POST /api/crm/attention` on Pipeline
- `pipeline/crm_pursuit.py` — pass `listingIds` in matchHints

### Do not touch
- Discovery ingest / Apify enrich

### Follow-ups
- LLM type classifier for leftover mail (still rules-first)
- Stale expectation nudges on Act deck ordering

---

**Scope:** Rejigg + WebsiteClosers format reading (stop generic-newsletter mash)  
**Risk:** medium (ingest money/title for two live senders)  
**Coords:** none

### Changed
- `pipeline/formats/repertoire.yaml` — providers + `rejigg.search_digest` + `websiteclosers.new_deal_alert`
- `pipeline/ingest.py` — `split_rejigg` / `split_websiteclosers`; Sales→revenue, Earnings→SDE; WC title from body not subject
- `pipeline/formats/fixtures/` — regression fixtures; live proof on dirk@ (8 Rejigg cards / 1 WC)

### Do not touch
- Apify BBS enrich path

### Follow-ups
- Next harvest re-parses new mail; old mashed Neon rows may need a re-import or correct pass
- Rejigg negative / projected EBITDA edge cases still fuzzy

---

## 2026-08-12 — `nm/web/crm-pursuit` — DONE

**Scope:** Pursuit “Open email” must open Dirk’s mailbox, not Tristan’s default Gmail  
**Risk:** low  
**Coords:** none

### Changed
- `web/lib/gmail-thread.ts` — `authuser=dirk@…` deep links + rewrite legacy `/u/0/` URLs
- `pursuit-links.tsx` — label **Open in Dirk**; normalize href at display
- `crm-pursuit.ts` / `pipeline/crm_pursuit.py` — write Dirk-scoped URLs going forward

### Do not touch
- Gmail OAuth token / catcher account wiring

### Follow-ups
- Tristan must be signed into `dirk@` in the same browser for the link to land on the thread

---

## 2026-08-11 — `nm/web/crm-pursuit` — DONE

**Scope:** Pursuit lane v1 — NDA links + auto CIM from dirk@ mail  
**Risk:** medium (new `/api/crm/pursuit`, schema cols, harvest step)  
**Coords:** none

### Changed
- `web/db/schema.sql` — `nda_url`, `gmail_thread_url`, `crm_events`
- `web/lib/crm-pursuit.ts` + `POST /api/crm/pursuit` — match + apply (import token)
- `pipeline/crm_pursuit.py` — classify non-discovery mail; wired into daily harvest
- `pursuit-links.tsx` / board / deal page — Sign NDA + Open email
- Act cards unchanged for human stage confirmation

### Follow-ups
- Improve match rate on Axial Messenger / VDR-only mail
- Needs-attention queue for unmatched events

## 2026-08-11 — `nm/web/pipeline` — DONE

**Scope:** Attach CIM to existing pipeline deals without debrief or Create-from-CIM  
**Risk:** low  
**Coords:** none

### Changed
- `web/components/attach-cim.tsx` — upload/replace via `/api/deal-files`
- `web/app/deals/[id]/page.tsx` — always-on CIM section
- `web/components/pipeline-board.tsx` — Attach/Replace CIM on every card

### Follow-ups
- none

## 2026-08-11 — `nm/web/cim-intake` — DONE

**Scope:** Upload CIM PDF → LLM extract → review → create deal on Pipeline at stage `cim`  
**Risk:** medium (AI Gateway + new `/api/cim/*`; 4MB PDF body)  
**Coords:** none

### Changed
- `web/lib/cim-extract.ts` — PDF text via unpdf + `generateText`/`Output.object` over AI Gateway
- `web/lib/deals.ts` — `createDealFromCim` (ext_id `cim:…`, stage `cim`, shortlist verdict, optional file)
- `web/app/api/cim/extract` / `create` — multipart extract + create
- `web/components/add-from-cim.tsx` + Pipeline header — “Add from CIM” review flow
- deps: `ai`, `unpdf`, `zod`

### Do not touch
- Existing attach-CIM-to-deal path (`/api/deal-files`) — still for deals already on board

### Follow-ups
- OCR for scanned CIMs; Word docs; session-mode extension catch

---

## 2026-08-06 — `nm/web/pipeline` — DONE

**Scope:** Pipeline Act/Board action deck, outreach debrief + CIM upload, stages Call/LOI/DD, nav tidy  
**Risk:** medium (new tables `outreach_events` / `deal_files`; schema re-apply on boot)  
**Coords:** none

### Changed
- `web/components/action-deck.tsx` / `pipeline-client.tsx` / `pipeline-board.tsx` — Act deck opens listing URLs then debriefs; Board with clickable stage filters
- `web/lib/playbooks.ts` — Axial “Pursue” + other-source open CTAs; actionable only with listing URL in shortlist/contacted/nda
- `web/lib/model.ts` — stages Call → LOI → Due Diligence after CIM; outreach outcomes; Offer = definitive/PSA
- `web/app/api/outreach/` / `deal-files/` / `web/lib/deals.ts` / `schema.sql` — persist debrief, CIM BYTEA + serve URL; `cim_url` on deals
- `web/lib/boot.ts` / `db.ts` — re-apply schema on ensureReady so new tables land in Neon/PGlite
- `pipeline/ingest.py` / repertoire — never pick Axial Pass/decline as listing URL; prefer pursue/teaser
- `web/components/nav.tsx` — top tabs Review + Pipeline; Data as small link under username

### Follow-ups
- Chrome extension / batch Axial NDA (Phase 2)
- Neon Pass→Pursue backfill runs on boot (`fixAxialPassUrls`); UI also rewrites on read

## 2026-08-06 — `nm/bbs/axial-url` — DONE

**Scope:** Never store/open Axial Pass links — Pursue only  
**Risk:** low  
**Coords:** none

### Changed
- `pipeline/ingest.py` — `pick_listing_url` prefers pursue; forces Pass params → Pursue
- `web/lib/playbooks.ts` / `deals.ts` / `import.ts` / `boot.ts` — rewrite on open, read, import, and boot UPDATE
- `docs/deal-format-repertoire.md` / `SYSTEM.md` — gotcha documented
- Seeds already use `action=pursue`

### Follow-ups
- none

## 2026-08-06 — `nm/web/fit` — DONE

**Scope:** Revenue-first proxy when earnings missing (not OR/AND)  
**Risk:** low  
**Coords:** none

### Changed
- `web/lib/fit.ts` / `pipeline/score.py` / `buybox.yaml` — if revenue present, it alone gates at 50% best case; asking floor only when revenue absent (so $1M rev / $600K asking in Austin still shows)

### Follow-ups
- none

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
