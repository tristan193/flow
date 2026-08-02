"""
Survey last N days of dirk@ mail for format-repertoire rebuild.

Writes:
  pipeline/formats/survey/inbox_5d.json   — full inventory (bodies truncated)
  pipeline/formats/survey/inbox_5d.csv    — one row per message
  pipeline/formats/survey/bodies/*.txt    — full body per msg (for format drafting)

Usage:
  python survey_inbox.py --days 5
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import harvest_gmail
import ingest as ing

OUT_DIR = os.path.join(HERE, "formats", "survey")
BODIES_DIR = os.path.join(OUT_DIR, "bodies")


def _open_lines(body: str, n: int = 8) -> str:
    lines = []
    for raw in (body or "").splitlines():
        s = raw.strip()
        if not s:
            if lines:
                break
            continue
        lines.append(s[:200])
        if len(lines) >= n:
            break
    return "\n".join(lines)


def _signal_hits(em: ing.RawEmail) -> dict:
    hay = f"{em.sender} {em.subject} {(em.body or '')[:8000]}".lower()
    open8 = _open_lines(em.body or "", 8).lower()
    return {
        "has_asking_price": bool(re.search(r"asking\s*price\s*:", hay)),
        "has_new_business_matches": bool(re.search(r"\bnew business matches?\b", hay)),
        "has_match_search_criteria": bool(
            re.search(r"match your search criteria", open8 + " " + hay[:1500])
        ),
        "has_in_todays_issue": bool(re.search(r"in today[’']?s issue", hay)),
        "has_new_listing": bool(re.search(r"^new listing\b", open8, re.M)),
        "has_nda": bool(re.search(r"sign\s+(?:the\s+)?nda|\bcim\b", hay)),
        "has_money": bool(ing.MONEY_SIGNAL.search(hay)),
        "has_franchise_section": bool(ing.FRANCHISE_SECTION.search(hay)),
        "numbered_digest_items": len(ing._numbered_digest_items(em.body or "")),
        "bizalert_listings": len(ing.split_bizbuysell(em.body or "")),
    }


def survey(days: int) -> list[dict]:
    emails = harvest_gmail.fetch_raw_emails(days=days)
    rows = []
    os.makedirs(BODIES_DIR, exist_ok=True)

    for em in emails:
        family = ing.format_family(em)
        domain, email_addr, nick = ing.attribution(em)
        matched = ing.classify_format(em, domain=domain, email=email_addr)
        family = (
            matched.format_family
            if matched and matched.format_family
            else family
        )
        blocks = ing.blocks_for_email(
            em, matched=matched, family=family, email_addr=email_addr,
        )
        kept = 0
        for i, b in enumerate(blocks):
            lst = ing.extract(
                b, family, em.msg_id, i,
                source=domain, sub_source=email_addr, nickname=nick,
                subject=em.subject,
                format_id=matched.format_id if matched else "",
                email_type=matched.email_type if matched else "",
            )
            if not ing._is_junk_title(lst.title):
                kept += 1

        sig = _signal_hits(em)
        open_txt = _open_lines(em.body or "", 10)
        body_path = os.path.join(BODIES_DIR, f"{em.msg_id}.txt")
        with open(body_path, "w", encoding="utf-8") as f:
            f.write(f"From: {em.sender}\nSubject: {em.subject}\nDate: {em.received}\n")
            subcat = matched.provider_subcategory if matched else ""
            f.write(
                f"source={domain} sub_source={email_addr} nickname={nick} "
                f"provider_subcategory={subcat} "
                f"format_family={family} format_id="
                f"{matched.format_id if matched else ''} "
                f"email_type={matched.email_type if matched else ''}\n"
            )
            f.write("=" * 72 + "\n")
            f.write(em.body or "")

        rows.append(
            {
                "msg_id": em.msg_id,
                "received": em.received,
                "sender": em.sender,
                "source": domain,
                "sub_source": email_addr,
                "nickname": nick,
                "provider_subcategory": (
                    matched.provider_subcategory if matched else None
                ),
                "format_family": family,
                "format_id": matched.format_id if matched else None,
                "email_type": matched.email_type if matched else None,
                "format_status": matched.status if matched else None,
                "format_score": matched.score if matched else 0,
                "subject": em.subject,
                "body_chars": len(em.body or ""),
                "split_blocks": len(blocks),
                "kept_listings": kept,
                "recognized_yield": kept > 0,
                "open_lines": open_txt,
                "signals": sig,
                "body_file": body_path,
            }
        )
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=5)
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    rows = survey(args.days)

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta = {
        "surveyed_at": stamp,
        "days": args.days,
        "query": f"newer_than:{args.days}d deliveredto:dirk@tullyinvesting.com in:anywhere",
        "attribution": {
            "source": "sender domain",
            "sub_source": "sender email address",
            "nickname": "human-facing label",
            "provider_subcategory": "mailbox subcategory under provider (From:)",
            "format_family": "internal splitter key (not stored as source)",
            "format_id": "repertoire.yaml id when matched",
            "email_type": "daily_digest | single_listing | …",
        },
        "message_count": len(rows),
        "messages": rows,
    }

    json_path = os.path.join(OUT_DIR, f"inbox_{args.days}d.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    csv_path = os.path.join(OUT_DIR, f"inbox_{args.days}d.csv")
    fieldnames = [
        "msg_id",
        "received",
        "source",
        "sub_source",
        "nickname",
        "provider_subcategory",
        "format_family",
        "format_id",
        "email_type",
        "format_status",
        "sender",
        "subject",
        "body_chars",
        "split_blocks",
        "kept_listings",
        "recognized_yield",
    ]
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r[k] for k in fieldnames})

    by_domain = Counter(r["source"] for r in rows)
    by_email = Counter(r["sub_source"] for r in rows)
    by_nick = Counter(r["nickname"] for r in rows)
    zero = [r for r in rows if r["kept_listings"] == 0]
    nonzero = [r for r in rows if r["kept_listings"] > 0]

    print(f"surveyed: {len(rows)} messages (last {args.days}d)")
    print(f"with yield: {len(nonzero)}  zero yield: {len(zero)}")
    print("\nby source (domain):")
    for d, n in by_domain.most_common():
        print(f"  {n:3d}  {d or '(none)'}")
    print("\nby sub_source (email):")
    for s, n in by_email.most_common():
        print(f"  {n:3d}  {s or '(none)'}")
    print("\nby nickname:")
    for s, n in by_nick.most_common():
        print(f"  {n:3d}  {s}")
    print("\nZERO YIELD (candidates for repertoire gaps):")
    for r in zero:
        subj = (r["subject"] or "")[:70].encode("ascii", "replace").decode("ascii")
        print(
            f"  - {r['msg_id'][:12]}  [{r['source']}/{r['sub_source']}]  "
            f"{r['nickname']}"
        )
        print(f"      subj: {subj}")
    print(f"\nwrote {json_path}")
    print(f"wrote {csv_path}")
    print("wrote bodies to " + BODIES_DIR)


if __name__ == "__main__":
    main()
