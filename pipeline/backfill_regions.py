"""Restore Axial region on shelf rows misfiled as City=ST, State=ST.

Pre-PR#45 extract_location wrote the first two paren codes (AK, CA) into
city/state and left region null. Blurbs strip the Geography block, and most
mail bodies are not retained locally, so we recover from the misfile pair
via geo.recover_misfiled_region. When a mail body is still on disk we
re-run extract_location and prefer that.

  python backfill_regions.py --db /path/to/nm_deals.db
  python backfill_regions.py --db /path/to/nm_deals.db --dry-run
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from geo import is_usps, recover_misfiled_region  # noqa: E402
from ingest import extract_location  # noqa: E402


def _mail_body_for_deal(con: sqlite3.Connection, deal_id: int) -> str | None:
    row = con.execute(
        """
        SELECT m.body
        FROM deal_sources ds
        JOIN mail m ON m.gmail_id = ds.msg_id
        WHERE ds.deal_id = ?
          AND m.body IS NOT NULL
          AND length(trim(m.body)) > 0
        ORDER BY length(m.body) DESC
        LIMIT 1
        """,
        (deal_id,),
    ).fetchone()
    return row["body"] if row else None


def _apply_extract(city, state, region, body: str):
    """Merge extract_location(body) into current fields. Returns (c,s,reg,src)."""
    c, s, _county, reg = extract_location(body)
    if reg:
        if c and s and is_usps(c) and is_usps(s):
            return None, None, reg, "mail"
        if c and s:
            return c, s, reg, "mail"
        if s and not c:
            return None, s, reg, "mail"
        return None, None, reg, "mail"
    if s and not (c and is_usps(c)):
        return c, s, region, "mail"
    return city, state, region, None


def backfill(con: sqlite3.Connection, dry_run: bool = False) -> dict:
    stats = {
        "scanned": 0,
        "from_mail": 0,
        "from_misfile": 0,
        "cleared_misfile": 0,
        "unchanged": 0,
    }
    rows = con.execute(
        "SELECT id, city, state, region, title, source FROM deals"
    ).fetchall()
    for r in rows:
        stats["scanned"] += 1
        did = r["id"]
        city = r["city"]
        state = r["state"]
        region = (r["region"] or "").strip() or None
        new_city, new_state, new_region = city, state, region
        source = None

        body = _mail_body_for_deal(con, did)
        if body:
            new_city, new_state, new_region, src = _apply_extract(
                new_city, new_state, new_region, body
            )
            if src:
                source = src

        if not new_region:
            recovered = recover_misfiled_region(new_city, new_state)
            if recovered:
                new_region = recovered
                new_city, new_state = None, None
                source = "misfile"

        if new_region and is_usps(new_city) and is_usps(new_state):
            new_city, new_state = None, None
            if source is None:
                source = "cleared_misfile"

        changed = (
            (new_city or None) != (city or None)
            or (new_state or None) != (state or None)
            or (new_region or None) != (region or None)
        )
        if not changed:
            stats["unchanged"] += 1
            continue

        if source == "mail":
            stats["from_mail"] += 1
        elif source == "misfile":
            stats["from_misfile"] += 1
        elif source == "cleared_misfile":
            stats["cleared_misfile"] += 1
        else:
            stats["from_mail"] += 1

        if dry_run:
            print(
                f"DRY id={did} src={source} "
                f"({city!r},{state!r},{region!r}) -> "
                f"({new_city!r},{new_state!r},{new_region!r}) "
                f"{(r['title'] or '')[:50]}"
            )
            continue

        con.execute(
            "UPDATE deals SET city=?, state=?, region=? WHERE id=?",
            (new_city, new_state, new_region, did),
        )

    if not dry_run:
        con.commit()
    return stats


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--db",
        default=os.path.join(HERE, "nm_deals.db"),
        help="Shelf sqlite path",
    )
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row
    cols = {d[1] for d in con.execute("PRAGMA table_info(deals)")}
    if "region" not in cols:
        con.execute("ALTER TABLE deals ADD COLUMN region TEXT")
        con.commit()

    stats = backfill(con, dry_run=args.dry_run)
    con.close()
    print(stats)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
