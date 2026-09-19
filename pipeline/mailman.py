"""
Mailman — persist every dirk@ message (Mailman’s token). Do not extract deals.

  python mailman.py --days 3
  python mailman.py --self-test

After store: archive Gmail messages newly labeled listing (remove INBOX).
Requires gmail.modify (see gmail_auth.py). Use --no-archive to skip.

Agent: nm/harvest/mailman
Dirk is not this connection.
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from typing import Optional

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import catcher
import ingest as ing

# Coarse store labels (mail table). Gmail archive is separate — listing only.
LISTING_TYPES = {"daily_digest", "single_listing"}
FOLLOW_TYPES = {"follow_up"}
CONTROL_TYPES = {"account_notice"}
NOISE_TYPES = {"newsletter_marketing"}


def label_for_email_type(email_type: str | None) -> str:
    et = (email_type or "").strip()
    if et in LISTING_TYPES:
        return "listing"
    if et in FOLLOW_TYPES:
        return "follow_up"
    if et in CONTROL_TYPES:
        return "control"
    if et in NOISE_TYPES:
        return "noise"
    return "unknown"


def classify_mail(em: ing.RawEmail) -> tuple[str, str, str]:
    """Return (label, format_id, email_type). Never extracts a Listing."""
    domain, email, _nick = ing.attribution(em)
    matched = ing.classify_format(em, domain=domain, email=email)
    fmt_id = matched.format_id if matched else ""
    em_type = matched.email_type if matched else ""
    return label_for_email_type(em_type), fmt_id, em_type


def _thread_id(msg: dict) -> Optional[str]:
    tid = msg.get("threadId")
    return str(tid) if tid else None


def archive_message(service, msg_id: str) -> None:
    """Remove INBOX so the message leaves the inbox (stays in All Mail / archive)."""
    service.users().messages().modify(
        userId="me",
        id=msg_id,
        body={"removeLabelIds": ["INBOX"]},
    ).execute()


def fetch_and_store(days: int, db_path: str, *, archive_listings: bool = True) -> dict[str, int]:
    import db
    import gmail_auth
    import harvest_gmail as hg
    from googleapiclient.discovery import build

    creds = gmail_auth.get_credentials()
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    q = catcher.gmail_query(days)
    ids = hg.list_message_ids(service, q)

    con = db.connect(db_path, wal=True)
    counts: Counter[str] = Counter()
    for mid in ids:
        msg = service.users().messages().get(userId="me", id=mid, format="full").execute()
        emails = _raw_from_message(msg)
        em = emails[0]
        label, fmt_id, em_type = classify_mail(em)
        tid = _thread_id(msg)
        mode = db.upsert_mail(
            con,
            gmail_id=em.msg_id,
            thread_id=tid,
            gmail_thread_url=catcher.gmail_thread_url(tid) or None,
            sender=em.sender,
            subject=em.subject,
            received=em.received,
            body=em.body,
            label=label,
            format_id=fmt_id or None,
            email_type=em_type or None,
        )
        counts[mode] += 1
        counts[f"label:{label}"] += 1

        # Archive only listing harvests. Never touch follow_up / control / noise / unknown.
        if archive_listings and label == "listing" and mode in {"new", "updated"}:
            try:
                archive_message(service, em.msg_id)
                counts["archived"] += 1
            except Exception as exc:  # noqa: BLE001 — count and keep going
                counts["archive_err"] += 1
                print(f"archive failed {em.msg_id}: {exc}", file=sys.stderr)

    con.commit()
    con.close()
    counts["raw"] = len(ids)
    return dict(counts)


def _raw_from_message(msg: dict) -> list[ing.RawEmail]:
    """Same decode path as harvest_gmail.fetch_raw_emails, one message."""
    from email.utils import parseaddr
    import harvest_gmail as hg

    headers = (msg.get("payload") or {}).get("headers") or []
    sender = hg._header(headers, "From")
    subject = hg._header(headers, "Subject")
    date = hg._header(headers, "Date")
    plain, html = hg._walk_parts(msg.get("payload") or {})
    if plain is None and html is None:
        data = ((msg.get("payload") or {}).get("body") or {}).get("data")
        mime = ((msg.get("payload") or {}).get("mimeType") or "").lower()
        if data:
            import base64

            text = base64.urlsafe_b64decode(data.encode("utf-8")).decode(
                "utf-8", errors="replace"
            )
            if "html" in mime:
                html = text
            else:
                plain = text
    body = ing.best_body(plain, html)
    _, addr = parseaddr(sender)
    return [
        ing.RawEmail(
            msg_id=str(msg.get("id") or ""),
            sender=sender or addr or "(unknown)",
            subject=subject,
            received=date,
            body=body,
        )
    ]


def _self_test() -> None:
    assert label_for_email_type("single_listing") == "listing"
    assert label_for_email_type("daily_digest") == "listing"
    assert label_for_email_type("follow_up") == "follow_up"
    assert label_for_email_type("account_notice") == "control"
    assert label_for_email_type("newsletter_marketing") == "noise"
    assert label_for_email_type("") == "unknown"
    assert label_for_email_type(None) == "unknown"

    em = ing.RawEmail(
        "m1",
        "BizAlert <alerts@bizbuysell.com>",
        "5 New Business Matches in Texas",
        "2026-09-18",
        body="Asking Price: $1,000,000\nhttps://www.bizbuysell.com/business-opportunity/x/123/?q=123",
    )
    label, fmt_id, em_type = classify_mail(em)
    assert label in {"listing", "unknown"}, (label, fmt_id, em_type)
    print("mailman self-test ok")


def main() -> None:
    ap = argparse.ArgumentParser(description="Mailman: store catcher mail, do not extract deals")
    ap.add_argument("--days", type=int, default=1)
    ap.add_argument(
        "--db",
        default=os.path.join(HERE, "nm_deals.db"),
        help="SQLite path (mail table lives next to harvest deals)",
    )
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument(
        "--no-archive",
        action="store_true",
        help="Skip Gmail INBOX removal after listing harvest",
    )
    args = ap.parse_args()

    if args.self_test:
        _self_test()
        return

    local_db = os.environ.get("NM_LOCAL_DB", args.db)
    stats = fetch_and_store(args.days, local_db, archive_listings=not args.no_archive)
    print(
        f"mailman: raw={stats.get('raw', 0)} new={stats.get('new', 0)} "
        f"updated={stats.get('updated', 0)} archived={stats.get('archived', 0)} "
        f"path={local_db}"
    )
    for k in sorted(stats):
        if k.startswith("label:") or k == "archive_err":
            print(f"  {k} {stats[k]}")


if __name__ == "__main__":
    main()
