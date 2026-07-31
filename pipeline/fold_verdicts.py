"""
Fold Drive verdict logs into nm_deals.db.

The artifact only ever APPENDS verdict logs to the shared Drive folder — it
never updates or deletes (the Drive connector can't). So reconciliation is
last-write-wins per (deal_id, member), ordered by the verdict's own timestamp.

Harvest usage:
  1. search_files: parentId = '<folder>' and title contains 'verdicts-'
  2. download_file_content each -> base64 -> write the decoded JSON to a dir
  3. python3 fold_verdicts.py --logs <dir> --db nm_deals.db

An action of null means the reviewer cleared their verdict — the row is deleted.
Processed log filenames are recorded so re-running is idempotent.
"""
import sqlite3, json, argparse, os, glob


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--logs", required=True, help="directory of decoded verdict log .json files")
    ap.add_argument("--db", default="nm_deals.db")
    a = ap.parse_args()

    con = sqlite3.connect(a.db)
    con.row_factory = sqlite3.Row
    con.execute("CREATE TABLE IF NOT EXISTS verdict_logs_seen ("
                "name TEXT PRIMARY KEY, folded_at TEXT NOT NULL)")

    ext_to_id = {r["ext_id"]: r["id"]
                 for r in con.execute("SELECT id, ext_id FROM deals").fetchall()}

    events = []
    files = sorted(glob.glob(os.path.join(a.logs, "*.json")))
    skipped_files = 0
    for p in files:
        name = os.path.basename(p)
        if con.execute("SELECT 1 FROM verdict_logs_seen WHERE name=?", (name,)).fetchone():
            skipped_files += 1
            continue
        try:
            doc = json.load(open(p))
        except Exception as e:
            print(f"  ! unreadable, skipped: {name} ({e})")
            continue
        if doc.get("schema") != "nm_verdict_log_v1":
            print(f"  ! unknown schema, skipped: {name}")
            continue
        member = doc.get("member")
        for v in doc.get("verdicts", []):
            events.append((v.get("at") or doc.get("written_at") or "", name, member, v))

    events.sort(key=lambda e: e[0])   # last write wins

    applied = cleared = unknown = 0
    for at, name, member, v in events:
        deal_id = ext_to_id.get(v.get("deal_id"))
        if deal_id is None:
            unknown += 1          # deal not in this db (yet) — log stays, retried never; report it
            continue
        if v.get("action") is None:
            con.execute("DELETE FROM verdicts WHERE deal_id=? AND member=?", (deal_id, member))
            cleared += 1
        else:
            con.execute(
                "INSERT INTO verdicts (deal_id, member, action, reason, note, created_at) "
                "VALUES (?,?,?,?,NULL,?) "
                "ON CONFLICT(deal_id, member) DO UPDATE SET "
                "action=excluded.action, reason=excluded.reason, created_at=excluded.created_at",
                (deal_id, member, v["action"], v.get("reason"), at))
            applied += 1

    for p in files:
        name = os.path.basename(p)
        con.execute("INSERT OR IGNORE INTO verdict_logs_seen VALUES (?, datetime('now'))", (name,))

    con.commit()
    tot = con.execute("SELECT COUNT(*) FROM verdicts").fetchone()[0]
    con.close()
    print(f"folded: {len(files)-skipped_files} new logs ({skipped_files} already seen)  "
          f"applied={applied} cleared={cleared} unknown_deal={unknown}  verdicts_total={tot}")


if __name__ == "__main__":
    main()
