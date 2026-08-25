"""Unit checks for hard-match / verbatim title (no DB)."""
from __future__ import annotations

# Run via: node --experimental-strip-types won't work for TS easily.
# Use a tiny inline duplicate of the JS logic for smoke, or call via npx tsx.
# Prefer web-side test with node + dynamic import of compiled... 
# Simplest: duplicate extract in python and assert listing ids.

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from crm_pursuit import extract_listing_ids


def main() -> int:
    ids = extract_listing_ids(
        "see https://www.rejigg.com/app/businesses/124946?bid=124946",
        "https://www.websiteclosers.com/businesses/foo/119296/",
        "https://www.bizbuysell.com/business-opportunity/x/1234567/",
    )
    assert "124946" in ids, ids
    assert "119296" in ids, ids
    assert "1234567" in ids, ids
    print("listing id extract OK", ids)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
