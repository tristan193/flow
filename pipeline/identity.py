"""
Deal identity — join keys, fingerprints, aliases, thread lists.

Mirrors web/lib/identity.ts. Matching order (never skip to a weaker key):

  1. deal_number (TLY-001)
  2. source_deal_id / source_ids (Axial hex, BBS q=, V-AID, Transworld, …)
  3. complete fingerprint = normalize(teaser) + broker_firm + round(EBITDA) + geo
  4. alias / title overlap AND (broker if both known) AND (geo if both known)

NEVER match on broker name alone.
NEVER assume one Gmail thread = one deal.
Axial hex is taken from HTML Pursue/Pass URLs — never from the subject.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

EBITDA_ROUND = 10_000

JUNK_NAME_TOKENS = {
    "llc", "inc", "incorporated", "corp", "corporation",
    "ltd", "limited", "co", "company", "the", "and", "of", "a", "an",
}

# Dropped from broker-firm fingerprints only — not from teaser names.
JUNK_BROKER_TOKENS = JUNK_NAME_TOKENS | {
    "business", "advisors", "advisor", "international",
    "group", "partners", "capital", "associates", "brokerage",
}

AXIAL_PATH = re.compile(
    r"(?:opportunity|teaser-share|received-deals|teaser)/"
    r"([a-f0-9]{8,}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})",
    re.I,
)
AXIAL_QP = re.compile(
    r"(?:opportunityid|dealid|teaserid|oid|opportunity_id)=([a-f0-9]{8,}(?:-[a-f0-9]{4,})*)",
    re.I,
)
BBS_Q = re.compile(r"[?&]q=(\d{6,})", re.I)
BBS_PATH = re.compile(r"bizbuysell\.com/[^?\s\"'<>]*?/(\d{6,})/?", re.I)
REJIGG = re.compile(r"rejigg\.com/app/businesses/(\d+)", re.I)
WC = re.compile(r"websiteclosers\.com/businesses/[^?\s\"'<>]*?/(\d{3,})/?", re.I)
SMB = re.compile(r"[?&]recordid=([a-z0-9_-]{4,})", re.I)
VAID_LABELED = re.compile(r"\b(?:v-?aid|vaid)[:\s#-]*(\d{6})\b", re.I)
TRANSWORLD = re.compile(r"\b(\d{4}-\d{6})\b")
HEX_TOKEN = re.compile(r"^[a-f0-9]{8,}$", re.I)
UUIDISH = re.compile(r"^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$", re.I)

KIND_ORDER = ("axial", "bbs", "vaid", "tw", "rejigg", "wc", "smb")


def format_deal_number(n: int) -> str:
    if not isinstance(n, int) or n < 1:
        raise ValueError("Deal number must be a positive integer.")
    return f"TLY-{n:03d}"


def parse_deal_number(value: Optional[str]) -> Optional[int]:
    m = re.match(r"^TLY-0*(\d+)$", (value or "").strip().upper())
    if not m:
        return None
    n = int(m.group(1))
    return n if n > 0 else None


def normalize_teaser_name(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    text = raw.lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    tokens = [t for t in text.split() if t and t not in JUNK_NAME_TOKENS]
    return " ".join(tokens) or None


def normalize_broker_firm(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    text = raw.lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    tokens = [t for t in text.split() if t and t not in JUNK_BROKER_TOKENS]
    return " ".join(tokens) or None


def normalize_geo(city: Optional[str] = None, state: Optional[str] = None) -> Optional[str]:
    st = (state or "").strip().upper()
    c = re.sub(r"[^a-z0-9\s]", " ", (city or "").strip().lower())
    c = re.sub(r"\s+", " ", c).strip()
    if st and c:
        return f"{c}|{st}"
    if st:
        return st
    if c:
        return c
    return None


def round_ebitda(value: Optional[float]) -> Optional[int]:
    if value is None:
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return int(round(n / EBITDA_ROUND) * EBITDA_ROUND)


def compute_fingerprint(
    title: Optional[str] = None,
    broker_firm: Optional[str] = None,
    ebitda: Optional[float] = None,
    sde: Optional[float] = None,
    city: Optional[str] = None,
    state: Optional[str] = None,
) -> Tuple[Optional[str], bool]:
    teaser = normalize_teaser_name(title)
    broker = normalize_broker_firm(broker_firm)
    earnings = round_ebitda(ebitda if ebitda is not None else sde)
    geo = normalize_geo(city, state)
    if not teaser or not broker or earnings is None or not geo:
        return None, False
    return f"{teaser}|{broker}|{earnings}|{geo}", True


def _add_source(out: List[Dict[str, str]], kind: str, value: str) -> None:
    v = (value or "").strip().lower()
    if not v:
        return
    canonical = f"{kind}:{v}"
    if any(s["canonical"] == canonical for s in out):
        return
    out.append({"kind": kind, "value": v, "canonical": canonical})


def _haystack(parts: Iterable[Optional[str]]) -> str:
    return "\n".join(p for p in parts if p)


def extract_source_ids(
    url: Optional[str] = None,
    html: Optional[str] = None,
    body: Optional[str] = None,
    subject: Optional[str] = None,
    source: Optional[str] = None,
    nickname: Optional[str] = None,
    extra: Optional[Sequence[Dict[str, str]]] = None,
) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    for s in extra or []:
        if s.get("kind") and s.get("value"):
            _add_source(out, s["kind"], s["value"])

    url_html = _haystack([url, html, body])
    for rx in (AXIAL_PATH, AXIAL_QP):
        for m in rx.finditer(url_html):
            raw = m.group(1)
            if HEX_TOKEN.match(raw) or UUIDISH.match(raw):
                _add_source(out, "axial", raw)

    for m in BBS_Q.finditer(url_html):
        _add_source(out, "bbs", m.group(1))
    for m in BBS_PATH.finditer(url_html):
        _add_source(out, "bbs", m.group(1))
    for m in REJIGG.finditer(url_html):
        _add_source(out, "rejigg", m.group(1))
    for m in WC.finditer(url_html):
        _add_source(out, "wc", m.group(1))
    for m in SMB.finditer(url_html):
        _add_source(out, "smb", m.group(1))

    id_text = _haystack([subject, body, html])
    for m in VAID_LABELED.finditer(id_text):
        _add_source(out, "vaid", m.group(1))
    blob = f"{source or ''} {nickname or ''}".lower()
    if "vaid" in blob or "v-aid" in blob:
        lone = re.search(r"\b(\d{6})\b", subject or "")
        if lone:
            _add_source(out, "vaid", lone.group(1))

    for m in TRANSWORLD.finditer(id_text):
        _add_source(out, "tw", m.group(1))

    return out


def unique_strings(values: Iterable[Optional[str]]) -> List[str]:
    seen = set()
    out: List[str] = []
    for raw in values:
        v = (raw or "").strip()
        if not v:
            continue
        key = v.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(v)
    return out


def merge_alias_names(
    existing: Optional[Sequence[str]],
    incoming_title: Optional[str],
    stored_title: Optional[str],
    extra: Optional[Sequence[str]] = None,
) -> List[str]:
    aliases = unique_strings([*(existing or []), *(extra or [])])
    incoming = (incoming_title or "").strip()
    stored = (stored_title or "").strip()
    if incoming and stored and normalize_teaser_name(incoming) != normalize_teaser_name(stored):
        if not any(normalize_teaser_name(a) == normalize_teaser_name(stored) for a in aliases):
            aliases.append(stored)
        if not any(normalize_teaser_name(a) == normalize_teaser_name(incoming) for a in aliases):
            aliases.append(incoming)
    return unique_strings(aliases)


def merge_thread_ids(
    existing: Optional[Sequence[str]],
    incoming: Optional[Sequence[str]],
) -> List[str]:
    return unique_strings([*(existing or []), *(incoming or [])])


def pick_canonical_source_id(ids: Sequence[Dict[str, str]]) -> Optional[str]:
    for kind in KIND_ORDER:
        for s in ids:
            if s.get("kind") == kind:
                return s.get("canonical")
    return ids[0]["canonical"] if ids else None


def build_identity(
    title: Optional[str] = None,
    broker_firm: Optional[str] = None,
    city: Optional[str] = None,
    state: Optional[str] = None,
    ebitda: Optional[float] = None,
    sde: Optional[float] = None,
    url: Optional[str] = None,
    html: Optional[str] = None,
    body: Optional[str] = None,
    subject: Optional[str] = None,
    source: Optional[str] = None,
    nickname: Optional[str] = None,
    deal_number: Optional[str] = None,
    alias_names: Optional[Sequence[str]] = None,
    gmail_thread_ids: Optional[Sequence[str]] = None,
    source_ids: Optional[Sequence[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    ids = extract_source_ids(
        url=url, html=html, body=body, subject=subject,
        source=source, nickname=nickname, extra=source_ids,
    )
    fp, complete = compute_fingerprint(title, broker_firm, ebitda, sde, city, state)
    return {
        "deal_number": (deal_number or "").strip().upper() or None,
        "source_deal_id": pick_canonical_source_id(ids),
        "source_ids": ids,
        "fingerprint": fp,
        "fingerprint_complete": complete,
        "alias_names": unique_strings([*(alias_names or []), title or ""]),
        "gmail_thread_ids": unique_strings(gmail_thread_ids or []),
        "broker_firm": (broker_firm or "").strip() or None,
        "teaser_norm": normalize_teaser_name(title),
        "geo_norm": normalize_geo(city, state),
    }


def _candidate_ids(c: Dict[str, Any]) -> set:
    out = set()
    if c.get("source_deal_id"):
        out.add(str(c["source_deal_id"]).lower())
    for raw in c.get("source_ids") or []:
        if isinstance(raw, str):
            out.add(raw.lower())
        elif isinstance(raw, dict):
            if raw.get("canonical"):
                out.add(str(raw["canonical"]).lower())
            elif raw.get("kind") and raw.get("value"):
                out.add(f"{raw['kind']}:{raw['value']}".lower())
    return out


def _titles_overlap(a: Optional[str], names: Sequence[str]) -> bool:
    na = normalize_teaser_name(a)
    if not na:
        return False
    return any(normalize_teaser_name(t) == na for t in names)


def find_identity_match(
    incoming: Dict[str, Any],
    candidates: Sequence[Dict[str, Any]],
) -> Optional[Tuple[Dict[str, Any], str]]:
    ident = build_identity(
        title=incoming.get("title"),
        broker_firm=incoming.get("broker_firm") or incoming.get("brokerFirm"),
        city=incoming.get("city"),
        state=incoming.get("state"),
        ebitda=incoming.get("ebitda"),
        sde=incoming.get("sde"),
        url=incoming.get("url"),
        html=incoming.get("html"),
        body=incoming.get("body"),
        subject=incoming.get("subject"),
        source=incoming.get("source"),
        nickname=incoming.get("nickname"),
        deal_number=incoming.get("deal_number") or incoming.get("dealNumber"),
        alias_names=incoming.get("alias_names") or incoming.get("aliasNames"),
        gmail_thread_ids=incoming.get("gmail_thread_ids") or incoming.get("gmailThreadIds"),
        source_ids=incoming.get("source_ids") or incoming.get("sourceIds"),
    )

    n = parse_deal_number(ident["deal_number"])
    if n:
        for c in candidates:
            if parse_deal_number(c.get("deal_number") or c.get("dealNumber")) == n:
                return c, "deal_number"

    incoming_ids = {s["canonical"] for s in ident["source_ids"]}
    if incoming_ids:
        for c in candidates:
            if incoming_ids & _candidate_ids(c):
                return c, "source_id"

    if ident["fingerprint_complete"] and ident["fingerprint"]:
        for c in candidates:
            if c.get("fingerprint") == ident["fingerprint"]:
                return c, "fingerprint"

    incoming_title = incoming.get("title")
    incoming_aliases = unique_strings([*(incoming.get("alias_names") or incoming.get("aliasNames") or []), incoming_title or ""])
    incoming_broker = normalize_broker_firm(incoming.get("broker_firm") or incoming.get("brokerFirm"))
    incoming_geo = normalize_geo(incoming.get("city"), incoming.get("state"))

    for c in candidates:
        their_names = unique_strings([c.get("title") or "", *(c.get("alias_names") or c.get("aliasNames") or [])])
        name_hit = _titles_overlap(incoming_title, their_names) or any(
            _titles_overlap(a, their_names) for a in incoming_aliases
        )
        if not name_hit:
            continue
        their_broker = normalize_broker_firm(c.get("broker_firm") or c.get("brokerFirm"))
        if incoming_broker and their_broker and incoming_broker != their_broker:
            continue
        their_geo = normalize_geo(c.get("city"), c.get("state"))
        if incoming_geo and their_geo and incoming_geo != their_geo:
            continue
        broker_shared = bool(incoming_broker and their_broker and incoming_broker == their_broker)
        geo_shared = bool(incoming_geo and their_geo and incoming_geo == their_geo)
        if not broker_shared and not geo_shared:
            continue
        return c, "alias"

    return None


def is_non_deal_mail(
    subject: Optional[str] = None,
    sender: Optional[str] = None,
    source: Optional[str] = None,
    nickname: Optional[str] = None,
    format_id: Optional[str] = None,
) -> bool:
    subj = (subject or "").lower()
    blob = f"{sender or ''} {source or ''} {nickname or ''} {format_id or ''}".lower()
    if "action summary" in subj:
        return True
    if "action_summary" in (format_id or ""):
        return True
    if re.search(r"\bahc\b|ahcpartners|american healthcare", blob) and re.search(
        r"blast|digest|newsletter", subj + blob
    ):
        return True
    if re.search(r"\bbaton\b", blob) and re.search(r"digest|newsletter|weekly|blast", subj + blob):
        return True
    return False


def gmail_all_href(thread_id: str) -> str:
    return f"https://mail.google.com/mail/u/0/#all/{thread_id.strip()}"
