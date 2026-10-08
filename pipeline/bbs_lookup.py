"""
Look up BizBuySell listing pages and print the fields to copy onto a deal.

Does not label mail, does not write the database, and does not POST.
Mailman (or anyone) passes q= ids or listing URLs. Stdout is one JSON object.

  python bbs_lookup.py 2483522 2562233
  python bbs_lookup.py q=2483522
  python bbs_lookup.py "https://www.bizbuysell.com/listings/Profile/?q=2483522"

Copy asking, sde, ebitda, revenue, city, state, and blurb onto the deal.
Leave a field alone when it is null. Progress lines go to stderr.
"""
from __future__ import annotations

import json
import re
import sys

import enrich_bizbuysell as bbs


def listing_query(raw: str) -> tuple[str, str]:
    """Return (q, profile URL) from a q id, q= id, or BizBuySell URL."""
    text = (raw or "").strip()
    if not text:
        raise ValueError("empty listing")
    match = re.search(r"(\d{6,})", text)
    if not match:
        raise ValueError(f"no BizBuySell listing id in {raw!r}")
    q = match.group(1)
    if text.lower().startswith("http"):
        return q, text
    return q, f"https://www.bizbuysell.com/listings/Profile/?q={q}"


def lookup_payload(queries: list[str], token: str = "") -> dict:
    parsed = [listing_query(q) for q in queries]
    urls = [url for _q, url in parsed]
    rows = bbs.listing_details(urls, token=token, quiet=True)
    listings = []
    for (q, _url), row in zip(parsed, rows):
        listings.append(
            {
                "q": q,
                "asking": row.get("asking"),
                "sde": row.get("sde"),
                "ebitda": row.get("ebitda"),
                "revenue": row.get("revenue"),
                "city": row.get("city"),
                "state": row.get("state"),
                "blurb": row.get("blurb"),
                "ok": bool(row.get("ok")),
                "error": row.get("error") or "",
            }
        )
    return {"ok": all(row["ok"] for row in listings) if listings else False, "listings": listings}


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in ("-h", "--help"):
        print(__doc__.strip())
        return 0 if args else 2
    try:
        payload = lookup_payload(args)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    json.dump(payload, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
