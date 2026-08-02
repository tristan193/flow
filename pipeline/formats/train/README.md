# Train AI → repertoire reviews

Markdown notes landed here by:

```bash
# From Flow App (auth required), save the open queue:
#   GET /api/train  →  flags.json
python formats/learn.py train-queue --input flags.json
```

Each file is a checklist against `repertoire.yaml` for one human Train AI flag.
Edit the format entry (gotchas / detect / status), then `learn.py validate`.
