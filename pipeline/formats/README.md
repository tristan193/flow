# Format repertoire

**System of record** for how deal email arrives, how we recognize it, and what
we expect to extract. Parsers in `ingest.py` implement formats; they must not
be the only place format knowledge lives.

| Artifact | Role |
|----------|------|
| [`repertoire.yaml`](./repertoire.yaml) | Providers, signals, email types, formats |
| [`catalog.py`](./catalog.py) | Load / validate / match |
| [`learn.py`](./learn.py) | CLI: summary, classify survey, propose stubs |
| [`_FORMAT_TEMPLATE.yaml`](./_FORMAT_TEMPLATE.yaml) | Copy-paste for a new format |
| [`stubs/`](./stubs/) | Auto-proposed drafts (not loaded until merged) |
| [`survey/`](./survey/) | Live inbox inventories + bodies |
| [`docs/deal-format-repertoire.md`](../../docs/deal-format-repertoire.md) | Playbook |

### Attribution triad (every format entry)

| Field | Meaning | Example |
|-------|---------|---------|
| `source` | Sender **domain** | `bizbuysell.com` |
| `sub_source` | Sender **email** | `bizalert@bizbuysell.com` |
| `nickname` | Human pill label | `BizBuySell` |
| `format_family` | Internal splitter key — **not** stored as `source` | `bizbuysell` |

Detection order: **sub_source / source → subject → body open → body markers**.

### Day-to-day commands

```bash
cd pipeline
pip install -r requirements.txt          # includes PyYAML
python formats/learn.py validate
python formats/learn.py summary
python survey_inbox.py --days 5          # refresh survey/
python formats/learn.py classify
python formats/learn.py propose          # unmatched → stubs/*.yaml
```

### Adding a new source / shape

1. Survey (or open an existing body under `survey/bodies/`).
2. `learn.py propose` if unmatched, or copy `_FORMAT_TEMPLATE.yaml`.
3. Fill `detect`, `email_type`, `expected_fields`, `gotchas`, `status`.
4. Merge into `repertoire.yaml` under `formats:` (and `providers:` if new domain).
5. `learn.py validate` then `classify`.
6. Only then add/adjust regex in `ingest.py`, referencing the format `id`.
