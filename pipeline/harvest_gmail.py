"""
Harvest deal mail from the catcher inbox into ingest.RawEmail objects.

Requires a prior successful `python gmail_auth.py` (token.json present).

  python harvest_gmail.py                 # last 1 day, print summary
  python harvest_gmail.py --days 3        # lookback
  python harvest_gmail.py --ingest        # also run ingest + upsert nm_deals.db
"""
from __future__ import annotations

import argparse
import base64
import os
import sys
from email.utils import parseaddr
from typing import List, Optional

from googleapiclient.discovery import build

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import gmail_auth
import ingest as ing


def _header(headers: list, name: str) -> str:
    name_l = name.lower()
    for h in headers or []:
        if h.get("name", "").lower() == name_l:
            return h.get("value", "")
    return ""


def _walk_parts(payload: dict) -> tuple[Optional[str], Optional[str]]:
    """Return (plaintext, html) from a Gmail message payload."""
    plain = html = None

    def walk(part: dict) -> None:
        nonlocal plain, html
        mime = (part.get("mimeType") or "").lower()
        body = part.get("body") or {}
        data = body.get("data")
        if data and mime in ("text/plain", "text/html"):
            text = base64.urlsafe_b64decode(data.encode("utf-8")).decode("utf-8", errors="replace")
            if mime == "text/plain" and plain is None:
                plain = text
            elif mime == "text/html" and html is None:
                html = text
        for child in part.get("parts") or []:
            walk(child)

    walk(payload or {})
    return plain, html


def list_message_ids(service, query: str, max_results: int = 200) -> List[str]:
    ids: List[str] = []
    page_token = None
    while True:
        resp = (
            service.users()
            .messages()
            .list(userId="me", q=query, maxResults=min(100, max_results - len(ids)), pageToken=page_token)
            .execute()
        )
        for m in resp.get("messages") or []:
            ids.append(m["id"])
            if len(ids) >= max_results:
                return ids
        page_token = resp.get("nextPageToken")
        if not page_token:
            return ids


def fetch_raw_emails(
    days: int = 1,
    query_extra: str = "",
    token_path: str = gmail_auth.DEFAULT_TOKEN,
    client_secret: str = gmail_auth.DEFAULT_CLIENT,
) -> List[ing.RawEmail]:
    creds = gmail_auth.get_credentials(client_secret, token_path)
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)

    # Prefer deliveredto: so BCC / list traffic still matches the catcher address.
    # Also include in:anywhere so spam-filed digests are not invisible gaps.
    q = f"newer_than:{days}d deliveredto:dirk@tullyinvesting.com in:anywhere"
    if query_extra:
        q = f"({q}) {query_extra}"

    out: List[ing.RawEmail] = []
    for mid in list_message_ids(service, q):
        msg = (
            service.users()
            .messages()
            .get(userId="me", id=mid, format="full")
            .execute()
        )
        headers = (msg.get("payload") or {}).get("headers") or []
        sender = _header(headers, "From")
        subject = _header(headers, "Subject")
        date = _header(headers, "Date")
        plain, html = _walk_parts(msg.get("payload") or {})
        # Some simple messages put body on the top-level payload only
        if plain is None and html is None:
            data = ((msg.get("payload") or {}).get("body") or {}).get("data")
            mime = ((msg.get("payload") or {}).get("mimeType") or "").lower()
            if data:
                text = base64.urlsafe_b64decode(data.encode("utf-8")).decode(
                    "utf-8", errors="replace"
                )
                if "html" in mime:
                    html = text
                else:
                    plain = text

        body = ing.best_body(plain, html)
        _, addr = parseaddr(sender)
        out.append(
            ing.RawEmail(
                msg_id=mid,
                sender=sender or addr or "(unknown)",
                subject=subject,
                received=date,
                body=body,
            )
        )
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Harvest dirk@ mail into RawEmail / deals db")
    ap.add_argument("--days", type=int, default=1, help="Lookback window (Gmail newer_than:Nd)")
    ap.add_argument("--query", default="", help="Extra Gmail query terms")
    ap.add_argument(
        "--ingest",
        action="store_true",
        help="Run ingest + upsert into nm_deals.db after harvest",
    )
    ap.add_argument(
        "--db",
        default=os.path.join(HERE, "nm_deals.db"),
        help="SQLite path for --ingest (copy off OneDrive if writing heavily)",
    )
    args = ap.parse_args()

    emails = fetch_raw_emails(days=args.days, query_extra=args.query)
    print(f"harvested: {len(emails)} messages (last {args.days}d)")
    for e in emails:
        line = f"  - {e.msg_id[:12]}  {e.sender[:60]}  |  {e.subject[:70]}"
        print(line.encode("ascii", "replace").decode("ascii"))

    if not args.ingest:
        return

    import db

    kept, stats = ing.ingest(emails)
    print(
        f"ingest: raw={stats['raw']} kept={stats['kept']} merged={stats['merged']} "
        f"alerts={stats.get('alerts')}"
    )

    # Write on a local path if possible — OneDrive + SQLite is risky for long sessions.
    local_db = os.environ.get("NM_LOCAL_DB", args.db)
    con = db.connect(local_db, wal=True)
    counts = {"new": 0, "merged": 0, "repeat": 0}
    for listing in kept:
        _deal_id, mode = db.upsert(con, listing)
        counts[mode] = counts.get(mode, 0) + 1
    con.commit()
    con.close()
    print(f"db upsert: {counts} path={local_db}")


if __name__ == "__main__":
    main()
