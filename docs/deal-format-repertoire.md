# Deal Format Repertoire — Playbook

**How we learn and store email formats** for Nails & Mercy extraction.

Machine catalog: [`pipeline/formats/repertoire.yaml`](../pipeline/formats/repertoire.yaml)  
Loader / matcher: [`pipeline/formats/catalog.py`](../pipeline/formats/catalog.py)  
CLI: `python pipeline/formats/learn.py …`  
Handoff context: [`Deal_Extraction_Format_Repertoire_Whitepaper.md`](./Deal_Extraction_Format_Repertoire_Whitepaper.md)

---

## 1. What we store (four layers)

| Layer | Lives in | Purpose |
|-------|----------|---------|
| **Providers** | `repertoire.yaml` → `providers:` | Domain + known mailboxes → nickname |
| **Email types** | `email_types:` | digest / single / marketing / follow-up / notice |
| **Signals** | `signals:` | Named regexes reusable across formats |
| **Formats** | `formats:` | Full shape: detect rules, expected fields, gotchas, status |

Every **format** also carries the attribution triad:

| Field | Meaning | Example |
|-------|---------|---------|
| `source` | Sender **domain** | `bizbuysell.com` |
| `sub_source` | Sender **email** (or `*@domain`) | `bizalert@bizbuysell.com` |
| `nickname` | Human-facing pill | `BizBuySell` |

`format_family` picks the splitter / `ext_id` prefix. It is **not** the stored
`source` column.

---

## 2. Detection order (always)

1. **`sub_source` / `source`** (address, then domain)
2. **Subject line shape**
3. **Body open** (first meaningful lines after `strip_html`)
4. **Body markers** (confirmation / last resort)
5. Optional **named signals** from `signals:`

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

## 7. Live catalog highlights (5-day survey)

| Format id | sub_source | Type | Status |
|-----------|------------|------|--------|
| `bizbuysell.bizalert_digest` | `bizalert@` | digest | active |
| `bizbuysell.newbizopps_single` | `newbizopps@` | single | **needs_parser** (largest gap) |
| `axial.single_deal` | `newdeal@` | single | active (money provisional) |
| `axial.action_summary` | `notifications@` | account_notice | control |
| `smb_deal_hunter.daily_digest` | `helen@mail.smb…` | digest | active |
| `smb_deal_hunter.editorial` | same mailbox | marketing | control |

Same mailbox can host two formats (SMB digest vs editorial) — **body open**
decides type after address match.

---

## 8. Extraction rules (do not regress)

- Money / location: **regex-first**; bare `$` is never assigned to a field
- Ambiguous profit labels → **SDE**, not EBITDA
- BizAlert missing earnings is normal (`needs_llm_ok: [earnings]`)
- Never attribute forwarder domains as provider

---

## 9. Next leverage

1. Implement parser for `bizbuysell.newbizopps_single` → `active`
2. Axial LTM money lines (`Revenue` / `$7.6` / `M`)
3. Keep running `classify` after each survey so new mailboxes become stubs early
