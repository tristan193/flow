"""US location helpers shared by ingest and buy-box scoring.

City/ST stays the normal shape. Axial (and similar) teasers also send a
census/Axial *region* string — 'Western Midwest (IA, KS, …)' — which is not
a city. Callers store that on `region` and leave city/state empty rather than
filing the first two abbreviations as City, ST.
"""

from __future__ import annotations

import re
from typing import FrozenSet, Optional, Set

STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
    "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
    "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
    "WI", "WY", "DC",
}

# In-region band for this shop. NM is TOLA here even though some docs still
# list only TX/OK/LA/AR.
TOLA: FrozenSet[str] = frozenset({"TX", "OK", "LA", "AR", "NM"})

# Census divisions plus Axial aliases. Used when the paren list is truncated
# with an ellipsis, or the label has no paren list at all.
KNOWN_REGION_STATES = {
    "new england": frozenset({"CT", "ME", "MA", "NH", "RI", "VT"}),
    "middle atlantic": frozenset({"NJ", "NY", "PA"}),
    "mid atlantic": frozenset({"NJ", "NY", "PA"}),
    "east north central": frozenset({"IL", "IN", "MI", "OH", "WI"}),
    "eastern midwest": frozenset({"IL", "IN", "MI", "OH", "WI"}),
    "midwest east": frozenset({"IL", "IN", "MI", "OH", "WI"}),
    "west north central": frozenset({"IA", "KS", "MN", "MO", "NE", "ND", "SD"}),
    "western midwest": frozenset({"IA", "KS", "MN", "MO", "NE", "ND", "SD"}),
    "midwest west": frozenset({"IA", "KS", "MN", "MO", "NE", "ND", "SD"}),
    "south atlantic": frozenset({"DE", "DC", "FL", "GA", "MD", "NC", "SC", "VA", "WV"}),
    "east south central": frozenset({"AL", "KY", "MS", "TN"}),
    "west south central": frozenset({"AR", "LA", "OK", "TX"}),
    "south central": frozenset({"AR", "LA", "OK", "TX"}),
    "mountain": frozenset({"AZ", "CO", "ID", "MT", "NV", "NM", "UT", "WY"}),
    "pacific": frozenset({"AK", "CA", "HI", "OR", "WA"}),
    "west coast": frozenset({"CA", "OR", "WA"}),
}

# Label + at least two USPS codes in parens. Ellipsis (ASCII or unicode) is
# optional after the last code. "Austin (TX)" is one code — not a region.
_REGION_RE = re.compile(
    r"(?P<label>[A-Z][A-Za-z]+(?:[ \t]+[A-Z][A-Za-z]+){0,4})"
    r"[ \t]*\("
    r"(?P<body>[A-Z]{2}(?:[ \t]*,[ \t]*[A-Z]{2})+"
    r"(?:[ \t]*,[ \t]*(?:\.\.\.|…))?)"
    r"[ \t]*\)"
)

_GEOGRAPHY_LINE = re.compile(
    r"(?im)^[ \t]*Geography[ \t]*:?[ \t]*\n?[ \t]*(.+)$"
)

_STATE_IN_LIST = re.compile(r"\b([A-Z]{2})\b")


def is_usps(value: Optional[str]) -> bool:
    v = (value or "").strip().upper()
    return len(v) == 2 and v in STATES


def is_real_state(state: Optional[str], city: Optional[str] = None) -> bool:
    """True for a real ST (or City, ST). False for a paren-list misfile (IA, KS)."""
    if not is_usps(state):
        return False
    if city and is_usps(city):
        return False
    return True


def _norm_label(label: str) -> str:
    return re.sub(r"\s+", " ", (label or "").strip().lower())


def looks_like_region(text: Optional[str]) -> bool:
    raw = (text or "").strip()
    if not raw:
        return False
    if _REGION_RE.search(raw):
        return True
    return _norm_label(raw) in KNOWN_REGION_STATES


def states_of_region(text: Optional[str]) -> Set[str]:
    """USPS codes implied by a region string (paren list and/or known label)."""
    raw = (text or "").strip()
    if not raw:
        return set()
    listed: Set[str] = set()
    truncated = False
    label = ""
    m = _REGION_RE.search(raw)
    if m:
        label = m.group("label")
        body = m.group("body")
        truncated = "..." in body or "…" in body
        for code in _STATE_IN_LIST.findall(body):
            if code in STATES:
                listed.add(code)
    else:
        label = raw
    known = KNOWN_REGION_STATES.get(_norm_label(label), frozenset())
    if listed and not truncated:
        return listed
    return set(listed) | set(known)


def extract_region(text: str) -> Optional[str]:
    """Full region phrase from a teaser body, or None.

    Prefers a Geography: line when that line is a region; otherwise the first
    Label (ST, ST, …) match in the body.
    """
    if not text:
        return None
    geo = _GEOGRAPHY_LINE.search(text)
    if geo:
        line = geo.group(1).strip()
        m = _REGION_RE.search(line)
        if m:
            return m.group(0).strip()
        if looks_like_region(line):
            return line
    m = _REGION_RE.search(text)
    if m:
        return m.group(0).strip()
    return None


def region_key(text: Optional[str]) -> str:
    """Stable fingerprint token for a region string."""
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()
