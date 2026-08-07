# Deal Format Repertoire — Playbook

**How we learn and store email formats** for Nails & Mercy extraction.

Machine catalog: [`pipeline/formats/repertoire.yaml`](../pipeline/formats/repertoire.yaml)  
Loader / matcher: [`pipeline/formats/catalog.py`](../pipeline/formats/catalog.py)  
CLI: `python pipeline/formats/learn.py …`  
Handoff context: [`Deal_Extraction_Format_Repertoire_Whitepaper.md`](./Deal_Extraction_Format_Repertoire_Whitepaper.md)

---

## 1. What we store (five layers)

| Layer | Lives in | Purpose |
|-------|----------|---------|
| **Providers** | `providers:` | Brand / domain → nickname |
| **Provider subcategories** | `providers[].subcategories:` | **Sender mailbox** — primary format signal for automated mail |
| **Email types** | `email_types:` | digest / single / marketing / follow-up / notice |
| **Signals** | `signals:` | Named regexes reusable across formats |
| **Formats** | `formats:` | Full shape: detect rules, expected fields, gotchas, status |

### Provider subcategory = From: address

Most marketplace/broker automation uses a **fixed mailbox per product**. That
address alone often selects the right format:

| Provider | Subcategory id | Email | Default format |
|----------|----------------|-------|----------------|
| BizBuySell | `bizalert` | `bizalert@…` | digest |
| BizBuySell | `newbizopps` | `newbizopps@…` | single listing |
| Axial | `newdeal` | `newdeal@…` | single deal |
| Axial | `notifications` | `notifications@…` | account notice (subject splits variants) |

Subject/body still confirm and disambiguate when one mailbox serves two jobs
(e.g. SMB `helen@` → digest vs editorial).

Every **format** also carries the attribution triad:

| Field | Meaning | Example |
|-------|---------|---------|
| `source` | Sender **domain** | `bizbuysell.com` |
| `sub_source` | Sender **email** (or `*@domain`) | `bizalert@bizbuysell.com` |
| `nickname` | Human-facing pill | `BizBuySell` |
| `provider_subcategory` | Mailbox subcategory id | `bizalert` |

`format_family` picks the splitter / `ext_id` prefix. It is **not** the stored
`source` column.

---

## 2. Detection order (always)

1. **Provider subcategory** (`From:` mailbox → `subcategories[].email`)
2. **`sub_source` / `source`** on the format (address, then domain)
3. **Subject line shape**
4. **Body open** (first meaningful lines after `strip_html`)
5. **Body markers** / named **signals**

If a subcategory lists `default_format`, that format is strongly preferred.
Subject/body still win when the same mailbox has multiple formats
(`default_format: null`).

Forwards: unwrap `Forwarded message`, attribute the **original** mailbox — never
`tullyinvesting.com` / Gmail as provider.

---

## 3. Email types

| Type | Meaning | Typical yield |
|------|---------|---------------|
| `daily_digest` | Multi-listing alert / numbered issue | N listings |
| `single_listing` | One deal per email | 1 |
| `newsletter_marketing` | Editorial / promo | **0** |
| `follow_up` | NDA / CIM / buyer-profile thread | 0–1 (careful) |
| `account_notice` | Confirm / action summary / account change | **0** |

Control types (`newsletter_marketing`, `account_notice`) and formats with
`status: control` or `split: drop` are forced to zero yield in ingest.

---

## 4. Format status lifecycle

| Status | Meaning |
|--------|---------|
| `needs_samples` | Seen or suspected; not enough bodies yet |
| `stub` | Skeleton entry only |
| `needs_parser` | Detection verified; splitter/extractor missing |
| `provisional` | Parser exists; money/location still shaky |
| `active` | Trusted in production |
| `control` | Recognized non-deal mail — must stay at yield 0 |

**Rule:** do not add a new regex path in `ingest.py` without a repertoire `id`.

---

## 5. Workflow — learning a new source

```text
Inbox mail
   │
   ▼
survey_inbox.py --days 5     →  survey/inbox_5d.json + bodies/
   │
   ▼
learn.py classify            →  matched / unmatched / needs_parser
   │
   ├─ unmatched ──► learn.py propose ──► stubs/*.yaml
   │                      │
   │                      ▼
   │                 edit stub (detect, fields, gotchas)
   │                      │
   │                      ▼
   │                 merge into repertoire.yaml (+ providers if new)
   │
   ├─ needs_parser ──► implement splitter in ingest.py
   │                      promote status → provisional → active
   │
   └─ validate ──► learn.py validate && classify again
```

Commands (from `pipeline/`):

```bash
pip install -r requirements.txt
python formats/learn.py validate
python formats/learn.py summary
python survey_inbox.py --days 5
python formats/learn.py classify
python formats/learn.py propose
python formats/learn.py show bizbuysell.newbizopps_single
```

Template: [`pipeline/formats/_FORMAT_TEMPLATE.yaml`](../pipeline/formats/_FORMAT_TEMPLATE.yaml)

---

## 6. What a good format entry includes

- Triad fields + `format_family` + `email_type` + `status`
- `detect` with at least address **or** (domain + subject/open markers)
- `expected_fields.present` / `absent` (so missing BizAlert EBITDA is not an error)
- `gotchas` (HTML-only, franchise footer, forward chrome, …)
- `split` hint (`bizbuysell`, `newsletter`, `drop`, `needs_new_splitter`, …)
- Survey evidence when available (`survey_count_5d`, subject examples)

---

## 7. Train AI → listing vs criteria

The Flow App **Train AI** button is not triage. It has two themes:

### Listing error → repertoire

Wrong capture/parse. Reasons: EBITDA/Rev/Asking · Location · Blurb · Duplicate ·
Not a real deal · Other.

```text
Human flags deal (theme=listing + reason + optional note)
   │
   ▼
POST /api/train
   │  resolve format via sub_source / provider subcategory
   │  (web/lib/repertoire.meta.json ← learn.py validate)
   ▼
train_flags row + inspection checklist (Neon)
   │
   ├─ Agent / human: GET /api/train  → by_theme.listing
   └─ learn.py train-queue --input flags.json
          → pipeline/formats/train/*.md review notes
          → edit repertoire.yaml (gotchas / detect / status)
```

When you (or an agent) act on a **listing** flag:

1. Open the matched `format_id` in `repertoire.yaml`.
2. Walk the inspection checklist (detect, expected_fields, split, control).
3. Append a `gotchas:` line or tighten patterns — then `learn.py validate`.
4. Only change `ingest.py` after the repertoire entry says what changed.

`repertoire.meta.json` is regenerated on every `learn.py validate` (also copied
to `web/lib/` so the app stays in sync).

### Criteria → buy-box queue (conservative)

Two options only:

| Intent | Meaning |
|--------|---------|
| **Should be excluded** | Current hard rules should already have kept this out; it slipped in |
| **Request criteria change** | Nuanced free-text ask to change thesis/rules (**detail required**) |

Hard rules already live in `pipeline/buybox.yaml` + `web/lib/fit.ts`, and **most
have exceptions**. Agents must:

- **Never** auto-edit the buy box from a single flag.
- Act on **exclusion misses** only when the miss is clear and the patch is narrow.
- Act on **criteria change** notes **only** when a **strong repeated trend**
  emerges — prefer leaving notes queued over inventing new hard excludes.

`GET /api/train` exposes `by_theme` and `by_intent` for queue triage.

---

## 8. Live catalog highlights (5-day survey)

| Format id | sub_source | Type | Status |
|-----------|------------|------|--------|
| `bizbuysell.bizalert_digest` | `bizalert@` | digest | active |
| `bizbuysell.newbizopps_single` | `newbizopps@` | single | **active** (`split_bizbuysell_newbizopps`) |
| `axial.single_deal` | `newdeal@` | single | active (money provisional; **URL = Pursue, never Pass**) |
| `axial.action_summary` | `notifications@` | account_notice | control |
| `smb_deal_hunter.daily_digest` | `helen@mail.smb…` | digest | active |
| `smb_deal_hunter.editorial` | same mailbox | marketing | control |

Same mailbox can host two formats (SMB digest vs editorial) — **body open**
decides type after address match.

---

## 9. Extraction rules (do not regress)

- Money / location: **regex-first**; bare `$` is never assigned to a field
- Ambiguous profit labels → **SDE**, not EBITDA
- BizAlert missing earnings is normal (`needs_llm_ok: [earnings]`)
- Never attribute forwarder domains as provider

---

## 10. Next leverage

1. Re-survey so attribution rows use real domain/email (old nicknames in `sub_source` leave forwards unmatched)
2. Axial LTM money lines (`Revenue` / `$7.6` / `M`)
3. Act on Train AI queue → repertoire gotchas (`learn.py train-queue`)
