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
    provider_subcategory: str = ""
    subcategory_label: str = ""


@dataclass(frozen=True)
class ProviderSubcategory:
    """Sender-mailbox subcategory under a provider domain."""
    provider_domain: str
    provider_nickname: str
    id: str
    email: str
    label: str = ""
    purpose: str = ""
    typical_email_type: str = ""
    default_format: str = ""
    note: str = ""

    @property
    def is_wildcard(self) -> bool:
        return self.email.startswith("*@")


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
    def provider_subcategory(self) -> str:
        return (self.raw.get("provider_subcategory") or "").lower()

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
        self.subcategories: List[ProviderSubcategory] = self._load_subcategories()
        self._validate()

    def _load_subcategories(self) -> List[ProviderSubcategory]:
        out: List[ProviderSubcategory] = []
        for prov in self.providers:
            domain = (prov.get("domain") or "").lower()
            nick = prov.get("nickname") or _core_cap(domain)
            rows = prov.get("subcategories") or []
            # Back-compat: older YAML used addresses: [{email, role}]
            if not rows and prov.get("addresses"):
                for addr in prov["addresses"]:
                    rows.append({
                        "id": _mailbox_slug(addr.get("email") or ""),
                        "email": addr.get("email"),
                        "label": addr.get("role") or "",
                        "purpose": addr.get("note") or addr.get("role") or "",
                    })
            for row in rows:
                email = (row.get("email") or "").lower().strip()
                if not email:
                    continue
                out.append(ProviderSubcategory(
                    provider_domain=domain,
                    provider_nickname=nick,
                    id=(row.get("id") or _mailbox_slug(email)).lower(),
                    email=email,
                    label=row.get("label") or "",
                    purpose=row.get("purpose") or "",
                    typical_email_type=row.get("typical_email_type") or "",
                    default_format=(row.get("default_format") or "") or "",
                    note=row.get("note") or "",
                ))
        return out

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
        for sub in self.subcategories:
            if sub.default_format and sub.default_format not in self._by_id:
                raise ValueError(
                    f"providers[{sub.provider_domain}/{sub.id}]: "
                    f"default_format {sub.default_format!r} not in formats"
                )

    def get(self, format_id: str) -> Optional[FormatEntry]:
        return self._by_id.get(format_id)

    def export_meta(self) -> Dict[str, Any]:
        """Slim JSON for the Flow App Train-AI → repertoire inspector."""
        formats = []
        by_email: Dict[str, str] = {}
        by_domain: Dict[str, List[str]] = {}
        for f in self.formats:
            formats.append({
                "id": f.id,
                "format_family": f.format_family,
                "source": f.source,
                "sub_source": f.sub_source,
                "provider_subcategory": f.provider_subcategory,
                "nickname": f.nickname,
                "email_type": f.email_type,
                "status": f.status,
                "split": f.split,
                "expected_fields": f.raw.get("expected_fields") or {},
                "gotchas": list(f.raw.get("gotchas") or []),
                "parser_notes": list(f.raw.get("parser_notes") or []),
            })
            if f.sub_source and "@" in f.sub_source and not f.sub_source.startswith("*"):
                by_email[f.sub_source.lower()] = f.id
            if f.source:
                by_domain.setdefault(f.source.lower(), []).append(f.id)
        subs = [
            {
                "id": s.id,
                "email": s.email,
                "provider_domain": s.provider_domain,
                "provider_nickname": s.provider_nickname,
                "default_format": s.default_format,
                "label": s.label,
                "purpose": s.purpose,
            }
            for s in self.subcategories
        ]
        return {
            "version": self.version,
            "updated": self.updated,
            "repertoire_path": "pipeline/formats/repertoire.yaml",
            "playbook_path": "docs/deal-format-repertoire.md",
            "formats": formats,
            "subcategories": subs,
            "by_email": by_email,
            "by_domain": by_domain,
        }

    def write_meta_json(self, *paths: Path) -> List[Path]:
        import json
        from datetime import date, datetime

        def _default(obj: Any) -> str:
            if isinstance(obj, (datetime, date)):
                return obj.isoformat()
            raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")

        meta = self.export_meta()
        written: List[Path] = []
        payload = json.dumps(meta, indent=2, default=_default) + "\n"
        for path in paths:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(payload, encoding="utf-8")
            written.append(path)
        return written

    def lookup_subcategory(
        self, email: str = "", domain: str = "",
    ) -> Optional[ProviderSubcategory]:
        """Resolve provider subcategory from sender mailbox (preferred) or domain."""
        e = (email or "").lower()
        d = (domain or "").lower() or _email_domain(e)
        # Exact mailbox first — this is the primary automated-mail signal.
        if e and "@" in e:
            for sub in self.subcategories:
                if not sub.is_wildcard and sub.email == e:
                    return sub
        # Wildcard *@domain under matching provider.
        if d:
            for sub in self.subcategories:
                if sub.is_wildcard:
                    tail = sub.email[2:]
                    if d == tail or d.endswith("." + tail) or sub.provider_domain == d:
                        return sub
        return None

    def nickname_for_domain(self, domain: str, email: str = "") -> Optional[str]:
        sub = self.lookup_subcategory(email=email, domain=domain)
        if sub:
            return sub.provider_nickname
        d = (domain or "").lower()
        for prov in self.providers:
            pd = (prov.get("domain") or "").lower()
            if pd and (d == pd or d.endswith("." + pd)):
                return prov.get("nickname") or None
        for f in self.formats:
            addrs = [a.lower() for a in (f.detect.get("sender_addresses") or [])]
            if email and email.lower() in addrs:
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

        Provider subcategory (sender mailbox) is resolved first and heavily
        weights the match — for many providers the From: address alone selects
        the product/format. Subject/body still confirm and break ties.
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
        subcat = self.lookup_subcategory(email=email, domain=domain)

        best: Optional[FormatMatch] = None
        for fmt in self.formats:
            score, reasons = self._score(
                fmt,
                email=email,
                domain=domain,
                subject=subj,
                open_text=open_text,
                hay=hay,
                subcat=subcat,
            )
            if score <= 0:
                continue
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
                provider_subcategory=subcat.id if subcat else fmt.provider_subcategory,
                subcategory_label=(subcat.label if subcat else "") or "",
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
        subcat: Optional[ProviderSubcategory] = None,
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

        # --- Provider subcategory (sender mailbox) — primary automated signal
        if subcat:
            if fmt.provider_subcategory and fmt.provider_subcategory == subcat.id:
                score += 80
                reasons.append(f"provider_subcategory:{subcat.id}")
            if subcat.default_format and subcat.default_format == fmt.id:
                score += 120
                reasons.append("subcategory_default_format")
            # Same mailbox but format tied to a *different* subcategory → soft reject
            # unless this format also lists the address (shared helen@ cases use
            # body open to compete fairly without default_format).
            if (
                fmt.provider_subcategory
                and fmt.provider_subcategory != subcat.id
                and not addr_hit
            ):
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
            and not (subcat and subcat.default_format == fmt.id)
            and (det.get("subject_patterns") or det.get("body_open_patterns") or det.get("body_markers"))
            and not (subj_hit or open_hit or marker_hit)
        ):
            return 0, []

        return score, reasons

    def unmatched_provider_hint(self, domain: str, email: str) -> Dict[str, Any]:
        """Draft fields for a new stub when mail doesn't match any format."""
        nick = self.nickname_for_domain(domain, email) or _core_cap(domain)
        sub_id = _mailbox_slug(email) if email else "any"
        return {
            "id": f"{_core(domain) or 'unknown'}.{sub_id}",
            "format_family": "newsletter",
            "source": domain or "unknown",
            "sub_source": email or (f"*@{domain}" if domain else "unknown"),
            "provider_subcategory": sub_id,
            "nickname": nick,
            "email_type": "single_listing",
            "confidence": "stub",
            "status": "needs_samples",
            "description": "Auto-proposed from unmatched survey mail — fill detect + expected_fields.",
            "detect": {
                "sender_addresses": [email] if email and not email.startswith("*") else [],
                "sender_domains": [domain] if domain else [],
                "subject_patterns": [],
                "body_open_patterns": [],
            },
            "expected_fields": {"present": [], "absent": []},
            "gotchas": [],
            "split": "newsletter",
            "provider_stub": {
                "domain": domain,
                "nickname": nick,
                "subcategories": [{
                    "id": sub_id,
                    "email": email or (f"*@{domain}" if domain else ""),
                    "label": sub_id,
                    "purpose": "Fill in — why this mailbox exists",
                    "typical_email_type": "single_listing",
                    "default_format": f"{_core(domain) or 'unknown'}.{sub_id}",
                }],
            },
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


def _mailbox_slug(email: str) -> str:
    local = (email or "").split("@", 1)[0].lower()
    local = re.sub(r"[^a-z0-9]+", "_", local).strip("_")
    return local or "mailbox"


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
