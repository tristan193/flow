#!/usr/bin/env bash
# Cloud / CI daily harvest with retries. Used by GitHub Actions.
set -euo pipefail

DAYS="${DAYS:-2}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"
BACKOFFS=(60 300 900)
PIPELINE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PIPELINE_DIR"

if [[ ! -f credentials/token.json ]]; then
  echo "FATAL: credentials/token.json missing"
  exit 1
fi

export PYTHONIOENCODING=utf-8
export NM_LOCAL_DB="${NM_LOCAL_DB:-$PIPELINE_DIR/nm_deals.db}"

attempt=0
ok=0
while [[ $attempt -lt $MAX_ATTEMPTS && $ok -eq 0 ]]; do
  attempt=$((attempt + 1))
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) attempt $attempt/$MAX_ATTEMPTS days=$DAYS"
  set +e
  python harvest_gmail.py --days "$DAYS" --ingest
  rc=$?
  set -e
  if [[ $rc -eq 0 ]]; then
    ok=1
  else
    echo "FAIL attempt $attempt rc=$rc"
    if [[ $attempt -lt $MAX_ATTEMPTS ]]; then
      wait=${BACKOFFS[$((attempt - 1))]:-900}
      echo "retrying in ${wait}s"
      sleep "$wait"
    fi
  fi
done

if [[ $ok -ne 1 ]]; then
  echo "FATAL: all $MAX_ATTEMPTS attempts failed"
  exit 1
fi

# Dated CSV snapshot (artifact backup — Flow App is the live review surface)
python <<'PY'
import csv, os, sqlite3
from datetime import datetime, timezone
here = os.getcwd()
db = os.environ.get("NM_LOCAL_DB", os.path.join(here, "nm_deals.db"))
stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
out = os.path.join(here, f"nails-mercy-deals-{stamp}.csv")
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
try:
    rows = con.execute("SELECT * FROM v_deals").fetchall()
except sqlite3.OperationalError:
    rows = con.execute("SELECT * FROM deals").fetchall()
cols = list(rows[0].keys()) if rows else ["ext_id", "title"]
with open(out, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(cols)
    for r in rows:
        w.writerow([r[c] for c in cols])
print(f"CSV export: {out} rows={len(rows)}")
con.close()
PY

# Push into Flow App. This is the live path — no Drive involved.
# Requires FLOW_APP_URL + FLOW_IMPORT_TOKEN (set as GitHub Actions secrets).
if [[ -n "${FLOW_APP_URL:-}" && -n "${FLOW_IMPORT_TOKEN:-}" ]]; then
  echo "Pushing snapshot to Flow App at $FLOW_APP_URL"
  python export_snapshot.py --db "$NM_LOCAL_DB" --post "$FLOW_APP_URL" --token "$FLOW_IMPORT_TOKEN"
else
  echo "WARN: FLOW_APP_URL / FLOW_IMPORT_TOKEN not set — skipping Flow App push"
fi

echo "SUCCESS"
