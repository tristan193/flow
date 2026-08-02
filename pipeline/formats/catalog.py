"""
Format repertoire catalog — load, validate, match.

Single source of truth for:
  - providers (domain → nickname, known mailboxes)
  - email types (digest / single / marketing / …)
  - named signals (reusable detect patterns)
  - formats (full expected shapes + gotchas + status)

Human contract: docs/deal-format-repertoire.md
Machine file:   pipeline/formats/repertoire.yaml
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

HERE = Path(__file__).resolve().parent
DEFAULT_PATH = HERE / "repertoire.yaml"

# Formats with these statuses may match but must not yield listings.
CONTROL_STATUSES = frozenset({"control", "drop"})
# Prefer more specific matches: exact address > subject > body open > domain-only.
STATUS_ORDER = {
    "active": 0,
    "needs_parser": 1,
    "provisional": 2,
    "control": 3,
    "stub": 4,
    "needs_samples": 5,
}


@dataclass(frozen=True)
class FormatMatch:
    format_id: str
    format_family: str
    source: str
    sub_source: str
    nickname: str
    email_type: str
    status: str
    confidence: str
    split: str
    score: int
    reasons: Tuple[str, ...] = ()


@dataclass
class FormatEntry:
    raw: Dict[str, Any]

    @property
    def id(self) -> str:
        return self.raw["id"]

    @property
    def format_family(self) -> str:
        return self.raw.get("format_family") or "newsletter"

    @property
    def source(self) -> str:
        return (self.raw.get("source") or "").lower()

    @property
    def sub_source(self) -> str:
        return (self.raw.get("sub_source") or "").lower()

    @property
    def nickname(self) -> str:
        return self.raw.get("nickname") or "Unknown"

    @property
    def email_type(self) -> str:
        return self.raw.get("email_type") or ""

    @property
    def status(self) -> str:
        return self.raw.get("status") or "stub"

    @property
    def confidence(self) -> str:
        return self.raw.get("confidence") or "stub"

    @property
    def split(self) -> str:
        return self.raw.get("split") or "newsletter"

    @property
    def detect(self) -> Dict[str, Any]:
        return self.raw.get("detect") or {}

    @property
    def expected_yield(self) -> bool:
        """False for marketing / account notices / explicit drop."""
        if self.status in CONTROL_STATUSES:
            return False
        if self.split in ("drop", "log_only"):
            return False
        if self.email_type in ("newsletter_marketing", "account_notice"):
            return False
        return True


class FormatCatalog:
    def __init__(self, data: Dict[str, Any], path: Optional[Path] = None):
        self.path = path
        self.version = data.get("version")
        self.updated = data.get("updated")
        self.email_types: Dict[str, Any] = data.get("email_types") or {}
        # Back-compat: older YAML had a bare list of type names.
        if isinstance(self.email_types, list):
            self.email_types = {t: {"description": ""} for t in self.email_types}
        self.signals: Dict[str, Any] = data.get("signals") or {}
        self.providers: List[Dict[str, Any]] = data.get("providers") or []
        self.shared_markers: Dict[str, Any] = data.get("shared_markers") or {}
        self.formats: List[FormatEntry] = [
            FormatEntry(f) for f in (data.get("formats") or []) if f.get("id")
        ]
        self._by_id = {f.id: f for f in self.formats}
        self._validate()

    def _validate(self) -> None:
        ids = [f.id for f in self.formats]
        if len(ids) != len(set(ids)):
            dupes = sorted({i for i in ids if ids.count(i) > 1})
            raise ValueError(f"Duplicate format ids: {dupes}")
        known_types = set(self.email_types) or {
            "daily_digest",
            "single_listing",
            "newsletter_marketing",
            "follow_up",
            "account_notice",
        }
        for f in self.formats:
            if f.email_type and f.email_type not in known_types:
                raise ValueError(f"{f.id}: unknown email_type {f.email_type!r}")
            for key in ("sender_addresses", "sender_domains", "subject_patterns",
                        "body_open_patterns", "body_markers"):
                val = f.detect.get(key)
                if val is not None and not isinstance(val, list):
                    raise ValueError(f"{f.id}: detect.{key} must be a list")

    def get(self, format_id: str) -> Optional[FormatEntry]:
        return self._by_id.get(format_id)

    def nickname_for_domain(self, domain: str, email: str = "") -> Optional[str]:
        d = (domain or "").lower()
        e = (email or "").lower()
        for prov in self.providers:
            pd = (prov.get("domain") or "").lower()
            if not pd:
                continue
            if d == pd or d.endswith("." + pd) or pd.endswith("." + d.split(".", 1)[-1]):
                for addr in prov.get("addresses") or []:
                    if (addr.get("email") or "").lower() == e and addr.get("nickname"):
                        return addr["nickname"]
                if prov.get("nickname"):
                    return prov["nickname"]
        # Fall back to format entries with matching domain / address.
        for f in self.formats:
            addrs = [a.lower() for a in (f.detect.get("sender_addresses") or [])]
            if e and e in addrs:
                return f.nickname
        for f in self.formats:
            domains = [x.lower() for x in (f.detect.get("sender_domains") or [])]
            if d and any(d == x or d.endswith("." + x) for x in domains):
                return f.nickname
        return None

    def match(
        self,
        *,
        sender: str = "",
        subject: str = "",
        body: str = "",
        source_domain: str = "",
        sub_source_email: str = "",
    ) -> Optional[FormatMatch]:
        """Score every format; return the best match or None.

        Detection order within a candidate (additive score):
          sender address → subject → body open → body markers → domain only.
        """
        email = _parse_email(sub_source_email) or _parse_email(sender)
        domain = ""
        for candidate in (source_domain, _email_domain(email), _email_domain(sender)):
            if candidate and "." in candidate and "@" not in candidate:
                domain = candidate.lower()
                break
        subj = subject or ""
        open_text = _open_text(body, 12)
        hay = f"{sender}\n{subj}\n{(body or '')[:12000]}"

        best: Optional[FormatMatch] = None
        for fmt in self.formats:
            score, reasons = self._score(fmt, email=email, domain=domain,
                                         subject=subj, open_text=open_text, hay=hay)
            if score <= 0:
                continue
            # Prefer higher score; tie-break by status freshness then id.
            cand = FormatMatch(
                format_id=fmt.id,
                format_family=fmt.format_family,
                source=fmt.source or domain,
                sub_source=email or fmt.sub_source,
                nickname=fmt.nickname,
                email_type=fmt.email_type,
                status=fmt.status,
                confidence=fmt.confidence,
                split=fmt.split,
                score=score,
                reasons=tuple(reasons),
            )
            if best is None or _better(cand, best):
                best = cand
        return best

    def _score(
        self,
        fmt: FormatEntry,
        *,
        email: str,
        domain: str,
        subject: str,
        open_text: str,
        hay: str,
    ) -> Tuple[int, List[str]]:
        det = fmt.detect
        score = 0
        reasons: List[str] = []

        addrs = [a.lower() for a in (det.get("sender_addresses") or [])]
        domains = [d.lower() for d in (det.get("sender_domains") or [])]
        sub_pat = (fmt.sub_source or "").lower()

        addr_hit = bool(email and email in addrs)
        if not addr_hit and email and sub_pat and not sub_pat.startswith("*") and "@" in sub_pat:
            addr_hit = email == sub_pat

        domain_hit = False
        if domain:
            for d in domains:
                if domain == d or domain.endswith("." + d):
                    domain_hit = True
                    break
            if not domain_hit and sub_pat.startswith("*@"):
                tail = sub_pat[2:]
                if domain == tail or domain.endswith("." + tail):
                    domain_hit = True
            if not domain_hit and fmt.source:
                fs = fmt.source.lower()
                if domain == fs or domain.endswith("." + fs):
                    domain_hit = True

        subj_hit = _any_re(det.get("subject_patterns"), subject)
        open_hit = _any_re(det.get("body_open_patterns"), open_text)
        marker_hit = _any_re(det.get("body_markers"), hay)

        # Provider-scoped formats must hit address or domain.
        if (addrs or domains or fmt.source) and not (addr_hit or domain_hit):
            return 0, []

        # Address-scoped formats: require the address (forwards should already
        # be attributed to the original mailbox by ingest.attribution).
        if addrs and not addr_hit:
            return 0, []

        if addr_hit:
            score += 100
            reasons.append("sender_address")
        if domain_hit:
            score += 20
            reasons.append("sender_domain")
        if subj_hit:
            score += 40
            reasons.append("subject")
        if open_hit:
            score += 30
            reasons.append("body_open")
        if marker_hit:
            score += 15
            reasons.append("body_marker")

        for sig_id in det.get("signals") or []:
            sig = self.signals.get(sig_id) or {}
            pat = sig.get("pattern")
            where = (sig.get("where") or "body").lower()
            text = {"subject": subject, "open": open_text, "body": hay}.get(where, hay)
            if pat and re.search(pat, text or "", re.I):
                score += int(sig.get("weight") or 10)
                reasons.append(f"signal:{sig_id}")

        if score <= 0:
            return 0, []

        # Domain-only formats that also declare subject/open/marker must hit one,
        # except explicit *.unknown catch-alls.
        if (
            not addr_hit
            and not fmt.id.endswith(".unknown")
            and (det.get("subject_patterns") or det.get("body_open_patterns") or det.get("body_markers"))
            and not (subj_hit or open_hit or marker_hit)
        ):
            return 0, []

        return score, reasons

    def unmatched_provider_hint(self, domain: str, email: str) -> Dict[str, Any]:
        """Draft fields for a new stub when mail doesn't match any format."""
        nick = self.nickname_for_domain(domain, email) or _core_cap(domain)
        return {
            "id": f"{_core(domain) or 'unknown'}.unclassified",
            "format_family": "newsletter",
            "source": domain or "unknown",
            "sub_source": email or f"*@{domain}" if domain else "unknown",
            "nickname": nick,
            "email_type": "single_listing",
            "confidence": "stub",
            "status": "needs_samples",
            "description": "Auto-proposed from unmatched survey mail — fill detect + expected_fields.",
            "detect": {
                "sender_addresses": [email] if email else [],
                "sender_domains": [domain] if domain else [],
                "subject_patterns": [],
                "body_open_patterns": [],
            },
            "expected_fields": {"present": [], "absent": []},
            "gotchas": [],
            "split": "newsletter",
        }


def _better(a: FormatMatch, b: FormatMatch) -> bool:
        # Prefer specific products over *.unknown catch-alls when scores tie.
        if a.format_id.endswith(".unknown") != b.format_id.endswith(".unknown"):
            return b.format_id.endswith(".unknown")
        if a.score != b.score:
            return a.score > b.score
        ao = STATUS_ORDER.get(a.status, 9)
        bo = STATUS_ORDER.get(b.status, 9)
        if ao != bo:
            return ao < bo
        return a.format_id < b.format_id


def _parse_email(sender: str) -> str:
    s = sender or ""
    m = re.search(r"<([^>]+)>", s)
    if m:
        return m.group(1).strip()
    if "@" in s:
        return s.strip()
    return ""


def _email_domain(value: str) -> str:
    m = re.search(r"@([\w.-]+\.[a-z]{2,})", (value or "").lower())
    return m.group(1) if m else ""


def _core(domain: str) -> str:
    parts = (domain or "").lower().split(".")
    return parts[-2] if len(parts) >= 2 else (domain or "unknown")


def _core_cap(domain: str) -> str:
    return _core(domain).capitalize() if domain else "Unknown"


def _open_text(body: str, n: int = 12) -> str:
    lines: List[str] = []
    for raw in (body or "").splitlines():
        s = raw.strip()
        if not s:
            if lines:
                break
            continue
        lines.append(s)
        if len(lines) >= n:
            break
    return "\n".join(lines)


def _any_re(patterns: Optional[Sequence[str]], text: str) -> bool:
    if not patterns or not text:
        return False
    for p in patterns:
        try:
            if re.search(p, text):
                return True
        except re.error:
            continue
    return False


def load_catalog(path: Optional[Path] = None) -> FormatCatalog:
    try:
        import yaml
    except ImportError as e:
        raise ImportError(
            "PyYAML is required for the format repertoire. "
            "pip install PyYAML"
        ) from e
    p = Path(path) if path else DEFAULT_PATH
    data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    return FormatCatalog(data, path=p)


@lru_cache(maxsize=1)
def get_catalog() -> FormatCatalog:
    return load_catalog()


def reload_catalog() -> FormatCatalog:
    get_catalog.cache_clear()
    return get_catalog()
