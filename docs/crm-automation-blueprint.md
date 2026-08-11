# CRM automation blueprint

**Goal:** Move pipeline deals forward from broker email (NDAs, CIMs, updates) without relying on someone manually reading `dirk@` and advancing the board.

**Status:** Blueprint only — not implemented.  
**Date:** 2026-08-11

---

## 1. Problem

| Layer | Today |
|-------|--------|
| **Discovery** | Automated — harvest → ingest → Review |
| **Pursuit (CRM)** | Mostly manual — Act debrief chips, Attach CIM, stage dropdown |

Broker updates, CIM PDFs, and NDA prompts land in Gmail and are **missed or mis-routed**:

- Attachments are never harvested (`harvest_gmail.py` text only).
- `follow_up` mail can become thin junk listings instead of CRM events.
- Axial “action summary” (NDA/CIM counts) is `control` / `split: drop`.
- Stage advances after shortlist require a human who already knows something happened.

---

## 2. North star

```
Broker mail → match pipeline deal → CRM signal
  → NDA available: link thread and/or NDA URL (human signs)
  → CIM received: auto-attach file to deal
  → Act cards still move stages when the human is ready
```

**Success metrics (MVP):**
- CIM in `dirk@` → file on the matched deal without manual upload.
- NDA request in `dirk@` → one click from Pipeline to the thread or sign URL.

---

## 3. Two lanes

**Lane A — Discovery (keep):** digests → listings → Review / buy-box. Unchanged mission.

**Lane B — Pursuit (build):** mail about deals already shortlisted/on the board → match → attach / surface next link. **Act deck stays** the place humans confirm progress (signed NDA, downloaded CIM, etc.) when automation cannot act.

---

## 4. Starting slice (build this first)

Explicitly **in** for v1:

| Signal | App does | App does not |
|--------|----------|--------------|
| **NDA available** (email asks to sign, or NDA URL present) | Match deal; surface **Open thread** and/or **Sign NDA** link on that deal / Needs attention | Sign the NDA, fill forms, or drive Axial UI |
| **CIM sent** (PDF/DOC attachment or clear download link) | Match deal; **auto-append** via `saveDealFile`; optional nudge toward stage `cim` (or leave stage to Act card) | Invent a new deal; replace human judgment on whether to pursue |
| **Act cards** | Unchanged — still the primary way to mark signed / received / dead | Replaced by automation |

Everything else (staleness digests, Axial action-summary fan-out, batch NDA extension, auto-dead) waits.

### Why this order
- Highest pain: materials arrive and never hit the board.
- Lowest risk: no e-sign; no irreversible stage without a human (stage bump on CIM can be propose-only if preferred).
- Reuses Attach CIM storage path; adds harvest attachments + match + NDA link surfacing.

---

## 5. Classification stack (not repertoire-only)

Repertoire is strong for **stable platform shapes** (Axial digests, action summaries, known aggregator templates). It is **weak** as the sole tool for pursuit mail:

- BizBuySell next steps usually come from **random local brokers** (one-off domains, no shared format).
- Even Axial pursuit threads are often **advisor-specific** replies, not the catalogued digest formats.

So Lane B uses a **stack**. Repertoire is an accelerator when it hits; it is not the gate.

| Priority | Tool | Catches | Misses alone |
|----------|------|---------|----------------|
| 1 | **Deal-centric matching** | Mail that cites a known URL / listing id / title near a pipeline deal; replies in a thread we already touched (`In-Reply-To`, references) | Cold broker mail with no shared identifiers |
| 2 | **Attachment + link heuristics** | PDF/DOC named like CIM/OM/teaser; “download CIM”, NDA portal links | Pure prose updates with no file |
| 3 | **LLM event classify** (AI Gateway) | Open-world broker prose → `{type, deal_cues, links, confidence}` | Needs a candidate set (pipeline deals) to stay cheap/accurate |
| 4 | **Repertoire** | Axial / known `follow_up` / action-summary shapes → typed CRM events without LLM | Random BBS brokers; novel Axial advisor mail |

**Routing rule:**  
1. Try match to pipeline deals (thread → URL → fuzzy title/broker).  
2. If matched (or strong attachment signal), run LLM or repertoire classify → CRM event.  
3. If repertoire fires with high confidence, skip LLM.  
4. If nothing matches any pipeline deal → **do not** create a discovery listing from pursuit-shaped mail; leave for Needs attention / ignore.

Train AI can still teach repertoire for *repeat* broker domains over time — that’s accretion, not the MVP dependency.

---

## 6. What we reuse vs build

| Capability | Reuse | Build |
|------------|--------|--------|
| Classify mail | Repertoire **when format known**; AI Gateway for open broker prose | Deal-match first; CRM types; optional repertoire tips from Train AI |
| Extract | `cim-extract` pattern | Short event extract (type, deal cues, links) |
| CIM files | `saveDealFile`, Attach CIM UI | Harvest PDF/DOC attachments into `deal_files` when matched |
| Stages | `moveStage`, `stageFromOutcomes`, `stage_events` | Policy: auto vs confirm |
| Surfacing | Act deck, playbooks | **Needs attention** queue on Pipeline |
| Listing refresh | Apify BBS enrich | Optional re-enrich when update cites BBS URL |
| Axial NDA at scale | Pursue playbook | Phase 2: extension / batch NDA (already in CHANGELOG) |

---

## 7. Event → stage policy (proposed)

| Event | Auto? | Action |
|-------|-------|--------|
| NDA link / “sign NDA” | Propose | `contacted` + next-action **Sign NDA** |
| NDA completed (high confidence) | Auto | → `nda` |
| CIM attached / download link | Auto attach | → `cim` if already ≥ contacted/nda |
| Updated financials in body | Auto fill nulls | Stay stage; flag “numbers updated” |
| Call booked / occurred | Propose | → `call` |
| No longer available | Propose | → `dead` (confirm) |
| Axial action summary | Parse → fan-out | Stop wholesale drop; emit per-deal events |

**Safety:** never auto-dead or move backward without confirm. Prefer forward-only advances and file/field fills.

---

## 8. Match before create

Follow-ups must resolve to an **existing** pipeline deal (URL, Axial id, title+broker, `In-Reply-To` / Message-ID). Never spawn a second listing for “here’s the CIM you requested.”

Random broker mail is expected to **fail repertoire** and still succeed via match + LLM.

---

## 9. Phases

### Phase 0 — Plumbing for the starting slice
- Persist Message-ID / thread headers (+ Gmail deep link if available).
- Harvest PDF/DOC attachments (bytes) alongside body text.
- Match helper: thread → URL → title/broker against pipeline deals only.
- Stop turning pursuit follow-ups into junk discovery listings.

### Phase 1 — Starting slice (NDA link + auto CIM)
- **NDA available:** CRM signal on matched deal with link to email thread and/or NDA URL; show on board/detail / Needs attention. Human signs elsewhere; Act card still records “Signed the NDA.”
- **CIM received:** auto `saveDealFile` on matched deal; board shows **View CIM**. Stage → `cim` either auto (forward-only) or propose — decide at implement time; default propose if unsure.
- Act cards unchanged for moving work forward.
- Classification: match-first + attachment heuristics + LLM for random brokers; repertoire shortcut when format known.

### Phase 2 — Later
- Staleness nudges; Axial action summary fan-out; Chrome / batch Axial NDA; digests.
- Repertoire accretion for frequent brokers (optional).

---

## 10. Explicit non-goals (for now)

- Replacing Review triage.
- Full e-sign / DocuSign product.
- Scraping Axial behind Akamai for NDA status (extension is the realistic path).
- Auto-LOI / auto-offer drafting.

---

## 11. Empirical notes — dirk@ last 5 days (2026-08-11)

Sample: **162** messages · **148** skipped as known discovery formats · **14** reviewed.

**Of the 8 CRM-shaped messages, repertoire matched zero** (`format_id` empty). Domains were random brokers + e-sign vendors — confirms match/LLM/heuristics over repertoire-first.

| Archetype | Example | MVP action |
|-----------|---------|------------|
| E-sign **NDA request** | Adobe Sign “Signature requested on NDA …”; body has `documents.adobe.com` URL | Match deal by NDA title ≈ deal title → **Sign NDA** link (+ Gmail thread) |
| E-sign **NDA completed** | Adobe “You signed…” + signed PDF | Match → note signed; Act card still optional; don’t treat PDF as CIM |
| Broker **NDA PDF attached** | hotmail “Deal #8673126” + `NDA Agreement.…fillable.pdf` | Match by BizBuySell deal # / title → **Open NDA PDF** / thread (human signs) |
| Broker **“I sent the NDA”** nudge | Valpak Dropbox Sign ping (duplicate) | Same as NDA available; dedupe |
| Marketplace **interest → NDA** | Baton “Interest from BizBuySell” | Match BBS listing → NDA CTA URL |
| **CIM PDF attached** | Sunbelt “Attached is Our CIM…” + `CIM MIDWEST ELECTRICAL….pdf` | Match by company name → **auto-append** file |
| **VDR / ShareFile** grant | Touchstone “granted access…” (thread reply) | Match via `In-Reply-To` / Axial subject → link to VDR email/thread (materials, not always CIM file) |
| Axial **Messenger** | “You have 1 new message from …” | Link into Axial thread / Gmail; not a listing |

Noise in the 14: Rejigg lead digest (should be discovery repertoire), ChatGPT, unmatched “New Deal Alert” marketing.

**Matching cues that worked in subject/body without repertoire:** deal title strings, `Deal #8673126`, “acted on [Axial name]”, CIM filename/company name.

---

- Stages / outcomes: `web/lib/model.ts`
- Harvest: `pipeline/harvest_gmail.py`, `pipeline/ingest.py`, `pipeline/formats/repertoire.yaml`
- CIM: `web/lib/cim-extract.ts`, `web/components/attach-cim.tsx`, `web/lib/deals.ts` (`saveDealFile`)
- Act deck: `web/components/action-deck.tsx`
- System map: `docs/agents/SYSTEM.md`
