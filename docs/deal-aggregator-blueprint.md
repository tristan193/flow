# Nails & Mercy — Deal Aggregator Blueprint

**v2 · July 30, 2026 · for agreement between Tristan and partner**

This is a decision document, not a build plan. Sections 1–4 are proposals to
agree or reject. Section 6 lists what's still open. Nothing further gets built
until this is signed off.

---

## 1. Ingestion — email is the bus

**Proposal: we never scrape. Every source arrives as email at one shared address.**

This came out of testing, not preference. Fetching BizBuySell's public Texas
listings page returned deals with *"TTM period ending 08/31/14"* — a decade-stale
cached snapshot, served with no error. That's the dangerous failure mode: it
looks like it works. A scraper-based system would have reported success every
morning while feeding us 2014.

All three sources already push structured flow into email:

| Source | Mechanism | Why email is the right path |
|---|---|---|
| BizBuySell | BizAlert saved-search digests | Free; survives site redesigns |
| Axial | Deal alerts from the paid seat | Login-walled, no public API — email is the *only* clean read |
| Newsletters | Already email | Same parser, zero marginal cost |

Consequences worth agreeing to explicitly:

- **No ToS exposure.** We're a recipient of mail we subscribed to.
- **New sources cost a subscription, not code.** BizQuest, DealStream, a broker's
  private list — all just arrive.
- **We are limited to what the alerts contain.** This is the real tradeoff. If a
  deal never hits an alert or newsletter, we never see it. Proprietary/off-market
  flow still comes from relationships, not this system.

**Saved searches should be deliberately over-broad** — geography and rough size
only, no industry filters. BizBuySell's taxonomy has no category for a backflow
prevention route. Better to reject 200 restaurants a day in our own code than
lose one water treatment company to their filing system.

### Inbox: aliases on Tristan's account (agreed)

Two Gmail aliases on `tristan@tullyinvesting.com`:

| Alias | Use |
|---|---|
| `deals@tullyinvesting.com` | All marketplace alerts and deal newsletters |
| `tw@tullyinvesting.com` | General signups / marketing, out of scope |

A filter on `deliveredto:deals@tullyinvesting.com` applies the **`deals`** label
and skips the inbox. The harvester queries `label:deals` and nothing else.

Why this is the right shape:

- **No auth problem.** It's Tristan's own account completing OAuth. No credential
  sharing, no delegation, no dependency on a second person's mailbox.
- **Narrow read scope.** The connector can reach the whole mailbox, but the
  harvester only ever queries one label. Personal mail is never in the query.
- **Subscription hygiene by construction.** Sources are segregated by the address
  they were given at signup, so a noisy newsletter can be cut off at the alias
  without touching inbox rules.

**Required filter settings** — the second one is not optional:

```
Matches:  deliveredto:deals@tullyinvesting.com
Do this:  Apply label "deals"
          Skip the Inbox
          Never send it to Spam      ← bulk digests from broker
                                       platforms get spam-filed routinely,
                                       and a spam-filed alert is an
                                       invisible ingestion gap
```

Use `deliveredto:` rather than `to:` — list and BCC-style sends (which is how
several newsletter platforms deliver) often don't populate the `To` header with
the subscribed address.

---

## 2. Pipeline

```
tristan@tullyinvesting.com  →  label:deals
   │  (fed by the deals@ alias)
   │  daily, 6:00am CT
   ├─ 1. HARVEST    last 24h of mail
   ├─ 2. ROUTE      identify source from sender
   ├─ 3. SPLIT      digest email → N listing blocks
   ├─ 4. EXTRACT    block → structured fields
   ├─ 5. DEDUPE     same deal across sources → one record
   ├─ 6. PERSIST    upsert into deals.db
   ├─ 7. SCORE      buy box → score + rationale        [PARKED]
   ├─ 8. PUBLISH    mobile report + email digest       [PARKED]
   └─ 9. TRIAGE     shortlist / pass / discuss         [PARKED]
```

**Proposal: extraction is regex-first, LLM-second.**

Money and location decide whether a deal passes the buy box, and they're the two
fields an LLM is most likely to hallucinate a *plausible* value for. Regex either
matches or it doesn't. The LLM is reserved for what regex genuinely can't do:
classifying business model from prose, and salvaging blocks where deterministic
extraction found nothing.

Corollary: **a bare `$395,000` with no nearby label is never assigned to a field.**
Guessing an unlabeled number into the earnings slot is how an asking price becomes
a phantom Tier 3 deal.

**Proposal: ambiguity is reported, not resolved.** A listing with no disclosed
earnings gets tagged `needs_llm: earnings`, not dropped. When local and national
signals conflict, `business_model_type` returns `AMBIGUOUS` and routes to human
triage — that field decides whether a national deal is hard-rejected on geography,
so a confidently wrong guess is expensive.

---

## 3. Data model

**Proposal: SQLite (`deals.db`) — one file, no infrastructure, ports to Postgres unchanged.**

Four tables:

- **`deals`** — the record. One row per unique opportunity.
- **`deal_sources`** — every email that mentioned a deal. Seeing the same listing
  in five newsletters is signal: it's been shopped hard and may be stale.
- **`verdicts`** — per-member triage. Independent rows; disagreement is preserved,
  never averaged into a consensus neither of us holds.
- **`ingest_runs`** — per-run yield log for health monitoring.

### Earnings: two columns (agreed)

```sql
ebitda  REAL NULL   -- only when the source said EBITDA
sde     REAL NULL   -- SDE, DE, "Cash Flow", owner benefit
```

Never collapsed. A listing publishing both populates both. Reports read a view
that prefers EBITDA and annotates SDE with `*`.

**Ambiguous labels file as SDE** (agreed). BizBuySell's "Cash Flow" includes owner
comp. Filing an ambiguous number as EBITDA overstates the business; filing it as
SDE is the conservative error, and the annotation keeps the uncertainty visible.

This already earned itself in testing: an HVAC deal arrived as `$620,000*` SDE-only,
then a later broker email disclosed $505,000 actual EBITDA. Same record, upgraded
basis, both numbers retained — and the deal got materially *less* attractive once
the real figure appeared.

### Idempotency and history

Re-running a morning doesn't duplicate rows. `first_seen` / `last_seen` /
`times_seen` mean we can tell that a deal has been sitting on the market for eight
months, which is diligence signal we'd otherwise throw away. Backfill only writes
into NULLs — a good number is never overwritten by a later worse one.

---

## 4. Monitoring

**Proposal: per-source yield vs. baseline, checked every run.**

Fifteen newsletters means fifteen HTML layouts, and a redesign turns a working
parser into a silent zero. Nobody notices the report quietly getting shorter.
If a source that normally yields 12 listings yields 0, that's an alert, not a
quiet success.

Baselines need ~a week of live mail to calibrate. Current values are placeholders.

---

## 5. Build sequence

| Phase | What | Status |
|---|---|---|
| 0 | Agree this blueprint | ← **we are here** |
| 1 | Create inbox, re-point subscriptions, connect Gmail | your action |
| 2 | Run ingestion on live mail for ~1 week, calibrate baselines | built, untested on real data |
| 3 | Agree the buy box against deals we've actually seen | drafted, parked |
| 4 | Scoring + daily report + triage UI | prototyped, parked |
| 5 | Feedback loop from pass reasons | designed, not built |

**Phase 3 deliberately follows Phase 2.** Tuning a buy box against imagined deals
is guesswork; tuning it against a week of real flow is not.

---

## 6. Open — needs your decision

1. **SDE scoring basis.** Tiers are stated in EBITDA. When only SDE is disclosed,
   do we (a) apply a haircut and score the result — currently defaulted to 0.85,
   (b) score SDE at face value, or (c) never auto-reject on SDE alone and route to
   manual review? This is a real judgment call about owner comp in our size range.

2. **Report cadence and delivery.** Daily email digest plus the web page, or web
   page only with email reserved for A-priority deals?

3. **Volume tolerance.** How many deals per day are you willing to look at? This
   sets how aggressive the filters need to be, and it's better decided by you than
   inferred by me.

4. **Do we track outreach?** Once a deal is shortlisted, does this system follow
   what happened next — contacted, NDA, CIM, passed — or does that live elsewhere?
   This is the line between a reader and a CRM, and it changes the schema.

5. **Off-market flow.** Does anything from broker relationships or direct outreach
   belong in this database, or is it strictly a marketplace-and-newsletter tool?

---

## 7. Known limitations

- **We only see what gets emailed.** No proprietary flow.
- **Newsletter parsing is the fragile link.** Heuristic block-splitting across
  fifteen formats. Yield monitoring catches breakage; it can't prevent it.
- **Sub-$1M listings are frequently misrepresented.** Published figures are a
  starting point for diligence, not facts.
- **Volume asymmetry.** BizBuySell will produce enormous low-quality volume; Axial
  produces fewer, better-qualified deals. Raw counts shouldn't drive attention.

---

## Files

| File | State |
|---|---|
| `ingest.py` | Built, tested against realistic email shapes |
| `db.py` | Built, schema + idempotent upsert tested |
| `buybox.yaml` | Draft — **do not tune until Phase 3** |
| `score.py` | Draft — parked |
| Daily Deal Report artifact | Prototype — parked, renders stale earnings format |
