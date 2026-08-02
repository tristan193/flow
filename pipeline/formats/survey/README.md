# Survey inventories (gitignored bodies)

JSON/CSV summaries may be committed; full `bodies/*.txt` stay local (see
root `.gitignore`).

```bash
cd pipeline
python survey_inbox.py --days 5
python formats/learn.py classify
```

Repertoire is rebuilt / extended from this inventory — see `../repertoire.yaml`
and `../../docs/deal-format-repertoire.md`.
