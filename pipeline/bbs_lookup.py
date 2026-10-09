"""
Look up BizBuySell listing pages and print the fields to copy onto a deal.

Does not label mail, does not write the database, and does not POST.
Mailman (or anyone) passes q= ids or listing URLs. Stdout is one JSON object.

  python bbs_lookup.py "2483522 | Successful, Growing Landscape Company in North Texas!"
  python bbs_lookup.py "https://www.bizbuysell.com/business-opportunity/thriving-water-and-fire-damage-restoration-company/2560996/"

A bare q= id is not enough. The actor URL needs the headline as the slug.
Without it the path is /business-opportunity/listing/{id}/ and the dataset comes back empty.

Copy asking, sde, ebitda, revenue, city, state, and blurb onto the deal.
Leave a field alone when it is null. Progress lines go to stderr.
"""
from __future__ import annotations

import json
import re
import sys

import enrich_bizbuysell as bbs


def split_queries(raw: str) -> list[str]:
    """One listing per line, or several on one line separated by ' ;; '."""
    text = (raw or "").replace(" ;; ", "\n")
    return [part.strip() for part in text.splitlines() if part.strip()]


def listing_query(raw: str) -> tuple[str, str, str]:
    """Return (q, url, title). Title is required unless the URL already has a slug."""
    text = (raw or "").strip()
    if not text:
        raise ValueError("empty listing")
    title = ""
    if "|" in text and not text.lower().startswith("http"):
        left, right = text.split("|", 1)
        text = left.strip()
        title = right.strip()
    match = re.search(r"(\d{6,})", text)
    if not match:
        raise ValueError(f"no BizBuySell listing id in {raw!r}")
    q = match.group(1)
    if text.lower().startswith("http"):
        path = text.lower()
        if "/business-opportunity/" not in path and not title:
            raise ValueError(
                f"{q} needs a headline. Pass `{q} | the listing title`"
            )
        return q, text, title
    if not title:
        raise ValueError(
            f"{q} needs a headline. Pass `{q} | the listing title`. "
            "A bare id is fetched as /business-opportunity/listing/{id}/ and comes back empty."
        )
    return q, f"https://www.bizbuysell.com/listings/Profile/?q={q}", title


def lookup_payload(queries: list[str], token: str = "") -> dict:
    parsed = [listing_query(q) for q in queries]
    urls = [url for _q, url, _title in parsed]
    titles = {url: title for _q, url, title in parsed if title}
    rows = bbs.listing_details(urls, titles=titles, token=token, quiet=True)
    listings = []
    for (q, _url, _title), row in zip(parsed, rows):
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
    if not payload["listings"]:
        return 1
    return 0 if any(row["ok"] for row in payload["listings"]) else 1


if __name__ == "__main__":
    sys.exit(main())
