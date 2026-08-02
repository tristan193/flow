# Format repertoire

Machine-readable catalog of expected deal email shapes.

| File | Role |
|------|------|
| `repertoire.yaml` | Detect signals, email types, expected fields, fixtures |
| [`docs/deal-format-repertoire.md`](../../docs/deal-format-repertoire.md) | Human/agent contract |

### Attribution triad (required on every format entry)

| Field | Meaning |
|-------|---------|
| `source` | Sender domain (`bizbuysell.com`) |
| `sub_source` | Sender email (`bizalert@bizbuysell.com`) |
| `nickname` | Human-facing label (`BizBuySell`) |
| `format_family` | Internal splitter key — **not** stored as `source` |

Detection order: **sub_source / source → subject → body open → body markers**.
