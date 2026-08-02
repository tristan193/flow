# Deal Format Repertoire

**Contract for extraction consistency.** Built from a live `dirk@` harvest
(5-day lookback, 61 messages, 2026-08-02), then merged with earlier fixture
knowledge.

| Artifact | Path |
|----------|------|
| Machine catalog | [`pipeline/formats/repertoire.yaml`](../pipeline/formats/repertoire.yaml) |
| Survey inventory | [`pipeline/formats/survey/inbox_5d.json`](../pipeline/formats/survey/inbox_5d.json) |
| Per-message bodies | `pipeline/formats/survey/bodies/` |
| Re-run survey | `python pipeline/survey_inbox.py --days 5` |

---

## Attribution triad (organizational contract)

Every listing stores three fields — keep these names and meanings everywhere
(pipeline, SQLite, Postgres, Flow App UI, this repertoire):

| Field | Meaning | Example |
|-------|---------|---------|
| **`source`** | Sender **domain** | `bizbuysell.com` |
| **`sub_source`** | Sender **email address** | `bizalert@bizbuysell.com` |
| **`nickname`** | Human-facing label (pill text) | `BizBuySell` |

UI may truncate for display; storage keeps full values. Automated deal mail
comes from fixed inboxes — **`sub_source` is one of the strongest format
signals** (e.g. `bizalert@` digest vs `newbizopps@` single).

`format_family` (`bizbuysell`, `axial`, `newsletter`, …) is an **internal**
splitter / health / `ext_id` prefix. It is **not** stored as `source`.

---

## 1. What the inbox actually looks like (last 5 days)

| Count | Shape | Yield today? |
|------:|-------|--------------|
| **35** | BizBuySell **`newbizopps@`** — `Business For Sale: …` single listing | **No** (parser gap) |
| **9** | BizBuySell **`bizalert@`** — `N New Business Match(es): …` digest | Yes |
| **4** | Axial **`newdeal@`** — one opportunity per email | Yes (money often wrong) |
| **2** | Axial **`notifications@`** — Action Summary | 0 (correct) |
| **1** | SMB Deal Hunter digest (`In Today's Issue`) | Yes |
| **1+** | SMB Deal Hunter editorial / podcast marketing | 0 (correct when not a digest) |
| **1** | Benchmark International broker follow-up | False-positive junk |
| **1** | Gateway M&A subscription confirm | 0 (correct) |
| **7** | Forwards from `tristan@` (mix of SMB digest + editorial) | Mixed |

**42 of 61 messages yielded zero listings** under the current splitter. Most of
that is **`bizbuysell.newbizopps_single`** — a real deal product we never taught
the pipeline to read.

---

## 2. Detection order (always)

1. **`sub_source` (sender address) / `source` (domain)**
2. **Subject line shape**
3. **How the email opens** (first meaningful lines after `strip_html`)
4. **Body markers** (confirmation / last resort)

Forwarded mail: unwrap `Forwarded message`, prefer original `From:` over
`tullyinvesting.com`.

---

## 3. Email types

| Type | Meaning |
|------|---------|
| `daily_digest` | Multi-listing alert / numbered issue |
| `single_listing` | One deal per email |
| `newsletter_marketing` | Editorial / program marketing — yield 0 |
| `follow_up` | NDA / buyer-profile / CIM thread |
| `account_notice` | Transactional / confirm / action summary — yield 0 |

---

## 4. Catalog — live sources first

### BizBuySell

| Format id | sub_source | Type | Notes |
|-----------|------------|------|-------|
| `bizbuysell.bizalert_digest` | `bizalert@bizbuysell.com` | digest | Asking + Location. Splitter works. |
| `bizbuysell.newbizopps_single` | `newbizopps@bizbuysell.com` | single | **needs_parser** — no `Location:` label. |

### Axial

| Format id | sub_source | Type |
|-----------|------------|------|
| `axial.single_deal` | `newdeal@axial.net` | single (provisional money) |
| `axial.action_summary` | `notifications@axial.net` | account_notice → 0 |
| `axial.deal_alert_digest` | `alerts@axial.net` | digest (fixture; not in 5d) |

### SMB / Benchmark / Gateway

See `repertoire.yaml`. Digest vs editorial for SMB is decided by body open
(`In Today's Issue`) after the same `helen@…` address.

---

## 5–8. Rules, extend, next step

- Regex-first for money/location; bare `$` never assigned; Profit/Cash Flow → SDE.
- New format → repertoire entry with triad fields → then `ingest.py`.
- **Next:** implement `bizbuysell.newbizopps_single` splitter.

Related: [`NM_Deal_Flow_Whitepaper.md`](./NM_Deal_Flow_Whitepaper.md),
[`pipeline/GMAIL_SETUP.md`](../pipeline/GMAIL_SETUP.md).
