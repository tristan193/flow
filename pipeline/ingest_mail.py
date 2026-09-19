"""
Feed listing-labeled Mailman rows into ingest → nm_deals.db.

Mailman already stored and labeled the mail (incl. thread_id + gmail_thread_url). This script does not call Gmail.

  python ingest_mail.py --days 3
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import db
import ingest as ing


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def load_listing_emails(con: sqlite3.Connection, days: int) -> list[ing.RawEmail]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, days))
    rows = con.execute(
        "SELECT gmail_id, thread_id, gmail_thread_url, sender, subject, received, body, harvested_at FROM mail WHERE label = 'listing'"
    ).fetchall()
    out: list[ing.RawEmail] = []
    for r in rows:
        harvested = _parse_ts(r["harvested_at"])
        if harvested is not None and harvested < cutoff:
            continue
        out.append(
            ing.RawEmail(
                msg_id=str(r["gmail_id"]),
                sender=str(r["sender"] or "(unknown)"),
                subject=str(r["subject"] or ""),
                received=str(r["received"] or ""),
                body=str(r["body"] or ""),
            )
        )
    return out


def run(db_path: str, days: int) -> dict[str, int]:
    con = db.connect(db_path, wal=True)
    emails = load_listing_emails(con, days)
    kept, stats = ing.ingest(emails)
    counts = {"new": 0, "merged": 0, "repeat": 0, "raw_mail": len(emails)}
    for listing in kept:
        _deal_id, mode = db.upsert(con, listing)
        counts[mode] = counts.get(mode, 0) + 1
    con.commit()
    con.close()
    counts["kept"] = stats.get("kept", 0)
    counts["ingest_raw"] = stats.get("raw", 0)
    return counts


def main() -> None:
    ap = argparse.ArgumentParser(description="Ingest Mailman listing mail into nm_deals.db")
    ap.add_argument("--days", type=int, default=3)
    ap.add_argument("--db", default=os.path.join(HERE, "nm_deals.db"))
    args = ap.parse_args()
    local_db = os.environ.get("NM_LOCAL_DB", args.db)
    counts = run(local_db, args.days)
    print(
        f"ingest_mail: mail={counts.get('raw_mail', 0)} kept={counts.get('kept', 0)} "
        f"upsert={ {k: counts[k] for k in ('new', 'merged', 'repeat') if k in counts} } "
        f"path={local_db}"
    )


if __name__ == "__main__":
    main()
