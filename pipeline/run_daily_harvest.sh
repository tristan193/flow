#!/usr/bin/env bash
# Cloud / CI daily harvest with retries. Used by GitHub Actions.
# First stage is Mailman (label mail). Harve extract is ingest_mail.py — not
# harvest_gmail.py --ingest. Do not email brokers. Do not invent listing URLs.
set -euo pipefail

DAYS="${DAYS:-2}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"
BACKOFFS=(60 300 900)
PIPELINE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PIPELINE_DIR"
MAILMAN_ONLY="$(printf '%s' "${MAILMAN_ONLY:-false}" | tr '[:upper:]' '[:lower:]')"

if [[ ! -f credentials/mailman_token.json ]]; then
  echo "FATAL: credentials/mailman_token.json missing (write GMAIL_TOKEN_JSON here)"
  exit 1
fi
if [[ ! -f credentials/client_secret.json ]]; then
  echo "FATAL: credentials/client_secret.json missing (write GMAIL_CLIENT_SECRET_JSON here)"
  exit 1
fi

export PYTHONIOENCODING=utf-8
export NM_LOCAL_DB="${NM_LOCAL_DB:-$PIPELINE_DIR/nm_deals.db}"

run_with_retries() {
  local label="$1"
  shift
  local attempt=0
  local ok=0
  local rc=0
  while [[ $attempt -lt $MAX_ATTEMPTS && $ok -eq 0 ]]; do
    attempt=$((attempt + 1))
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $label attempt $attempt/$MAX_ATTEMPTS days=$DAYS"
    set +e
    "$@"
    rc=$?
    set -e
    if [[ $rc -eq 0 ]]; then
      ok=1
    else
      echo "FAIL $label attempt $attempt rc=$rc"
      if [[ $attempt -lt $MAX_ATTEMPTS ]]; then
        wait=${BACKOFFS[$((attempt - 1))]:-900}
        echo "retrying in ${wait}s"
        sleep "$wait"
      fi
    fi
  done
  if [[ $ok -ne 1 ]]; then
    echo "FATAL: $label failed all $MAX_ATTEMPTS attempts"
    exit 1
  fi
}

echo "=== Mailman catcher (python mailman.py --days $DAYS) ==="
run_with_retries mailman python mailman.py --days "$DAYS"

if [[ "$MAILMAN_ONLY" == "true" || "$MAILMAN_ONLY" == "1" ]]; then
  echo "MAILMAN_ONLY=$MAILMAN_ONLY — skipping ingest, Apify, CSV. Harve is not run."
  echo "SUCCESS"
  exit 0
fi

echo "=== ingest listing mail (python ingest_mail.py --days $DAYS) ==="
run_with_retries ingest_mail python ingest_mail.py --days "$DAYS"

# BizBuySell page enrich is part of the main path: email only discovers URL +
# headline; SDE/EBITDA come from Apify. Skip only buy-box-excluded headlines.
if [[ -z "${APIFY_TOKEN:-}" ]]; then
  echo "FATAL: APIFY_TOKEN is required (BizBuySell enrich is part of harvest)"
  exit 1
fi
mkdir -p credentials
printf '%s' "$APIFY_TOKEN" > credentials/apify_token.txt
LIMIT_ARGS=()
if [[ -n "${BBS_ENRICH_LIMIT:-}" && "${BBS_ENRICH_LIMIT}" != "0" ]]; then
  LIMIT_ARGS=(--limit "$BBS_ENRICH_LIMIT")
fi
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) enriching BizBuySell via Apify ${LIMIT_ARGS[*]:-all}"
python enrich_bizbuysell.py --backend apify --newest "${LIMIT_ARGS[@]}"

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

echo "CSV export done. Flow App push is a separate Actions step (fails if secrets missing)."
echo "SUCCESS"
