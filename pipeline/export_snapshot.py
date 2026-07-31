"""
Nails & Mercy — snapshot exporter (SQLite pipeline -> Flow App).

The Python pipeline remains the source of extraction truth and keeps writing
nm_deals.db. Flow App reads deals from its own hosted database, so this script
is the bridge: it flattens v_deals + verdicts into a single JSON document that
Flow App can import, either as a seed file or by POSTing to /api/import.

  python export_snapshot.py [--db nm_deals.db] [--out ../web/db/seed-data.json]
  python export_snapshot.py --post https://web-tau-seven-77.vercel.app --token $FLOW_IMPORT_TOKEN

Live path: GitHub Actions daily harvest calls --post after each successful ingest.
Google Drive is not involved.
"""
import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))


def export(db_path: str) -> dict:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row

    deals = []
    for r in con.execute("SELECT * FROM v_deals ORDER BY earnings DESC"):
        deals.append({
            "extId": r["ext_id"] or f"deal-{r['id']}",
            "title": r["title"],
            "blurb": r["blurb"] or None,
            "subSource": r["sub_source"] or None,
            "sources": r["sources"] or None,
            "city": r["city"] or None,
            "state": r["state"] or None,
            "county": r["county"] or None,
            "revenue": r["revenue"],
            "ebitda": r["ebitda"],
            "sde": r["sde"],
            "asking": r["asking"],
            "businessModelType": r["business_model_type"] or "AMBIGUOUS",
            "needsLlm": json.loads(r["needs_llm"] or "[]"),
            "url": r["url_norm"] or None,
            "firstSeen": r["first_seen"],
            "lastSeen": r["last_seen"],
            "timesSeen": r["times_seen"] or 1,
        })

    # Verdicts are keyed by ext_id rather than the local integer id: Flow App's
    # primary keys are its own and must not be assumed to match this database's.
    verdicts = []
    try:
        rows = con.execute(
            "SELECT d.ext_id AS ext_id, v.member, v.action, v.reason, v.note, v.created_at "
            "FROM verdicts v JOIN deals d ON d.id = v.deal_id"
        ).fetchall()
    except sqlite3.OperationalError:
        rows = []
    for r in rows:
        verdicts.append({
            "extId": r["ext_id"],
            "member": r["member"],
            "action": r["action"],
            "reason": r["reason"] or None,
            "note": r["note"] or None,
            "createdAt": r["created_at"],
        })

    con.close()
    return {
        "schema": "flow_import_v1",
        "exportedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sourceDb": os.path.basename(db_path),
        "deals": deals,
        "verdicts": verdicts,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join(HERE, "nm_deals.db"))
    ap.add_argument("--out", default=os.path.join(HERE, "..", "web", "db", "seed-data.json"))
    ap.add_argument("--post", help="Flow App base URL to POST the snapshot to")
    ap.add_argument("--token", default=os.environ.get("FLOW_IMPORT_TOKEN", ""))
    a = ap.parse_args()

    if not os.path.exists(a.db):
        print(f"error: no database at {a.db}", file=sys.stderr)
        return 1

    payload = export(a.db)

    if a.post:
        if not a.token:
            print("error: --post needs --token or FLOW_IMPORT_TOKEN", file=sys.stderr)
            return 1
        base = a.post.strip().rstrip("/")
        if not base.startswith("https://") and not base.startswith("http://"):
            print(
                f"error: --post must be a full URL starting with https:// (got {base[:40]!r})",
                file=sys.stderr,
            )
            return 1
        req = urllib.request.Request(
            base + "/api/import",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {a.token.strip()}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req) as resp:
                print(f"posted -> {resp.status} {resp.read().decode()[:400]}")
        except urllib.error.HTTPError as e:
            print(f"error: {e.code} {e.read().decode()[:400]}", file=sys.stderr)
            return 1
    else:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=1)
        print(f"wrote {os.path.abspath(a.out)}")

    print(f"deals={len(payload['deals'])} verdicts={len(payload['verdicts'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
