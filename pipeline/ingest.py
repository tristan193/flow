"""
Nails & Mercy — INGESTION ENGINE v1.0

Email is the bus. Every source (BizBuySell BizAlert, Axial deal alerts,
newsletters) is subscribed as deals@tullyinvesting.com, an alias that lands in
tristan@tullyinvesting.com and is filtered to label:deals. The harvester queries
that label ONLY — personal mail is never in scope. This module turns
that mail into normalized, deduped Listing records.

FORMAT REPERTOIRE (read before changing route/split/extract):
    docs/deal-format-repertoire.md
    pipeline/formats/repertoire.yaml
Attribution triad (stored on every listing):
    source     = sender domain          (bizbuysell.com)
    sub_source = sender email address   (bizalert@bizbuysell.com)
    nickname   = human-facing label     (BizBuySell)
format_family is internal only (splitter / ext_id prefix) — not a stored "source".
Email type (digest vs single vs follow-up vs account notice) is the crucial
first classification step after attribution.

Pipeline stages:
    1. HARVEST    pull last-24h messages          [Gmail connector]
    2. ROUTE      identify source from sender      [deterministic]
    3. SPLIT      digest email -> N listing blocks [per-source]
    4. EXTRACT    block -> structured fields       [regex, LLM fallback]
    5. DEDUPE     merge the same deal across srcs  [3-pass]
    6. HEALTH     per-source yield monitoring      [alerting]

DESIGN NOTE — why regex before LLM:
Money and location are the two fields that decide whether a deal passes the
buy box, and they are the two fields an LLM is most likely to hallucinate a
plausible value for. Regex either matches or doesn't. The LLM is reserved for
what regex genuinely can't do: classifying business_model_type from prose,
and salvaging blocks where deterministic extraction found nothing.
"""

import re, json, hashlib
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Tuple
from difflib import SequenceMatcher
from html import unescape


def strip_html(html: str) -> str:
    """Stdlib-only HTML->text. Required in production: real BizBuySell
    BizAlert mail arrives with plaintextBody == '' — HTML is the only body
    Gmail returns for that sender. Any harvester that only reads
    plaintextBody silently drops every BizBuySell alert.

    Anchor hrefs are pulled out and appended inline as "text (URL)" BEFORE
    tags are stripped. Found necessary against real mail: a naive strip
    discards every link, and a listing's URL is the only fully reliable
    dedupe/re-identification key across separate emails — losing it means
    a later broker follow-up disclosing EBITDA can't be matched back to the
    original asking-price-only alert; it just creates a duplicate row."""
    if not html:
        return ""
    def _keep_href(m):
        href, text = m.group(1), m.group(2)
        text = re.sub(r"<[^>]+>", "", text).strip()
        if not href or href.lower().startswith(("mailto:", "#", "javascript:")):
            return text
        return f"{text} ({href})" if text else f"({href})"
    t = re.sub(r'<a\s[^>]*?href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', _keep_href,
               html, flags=re.S | re.I)
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", t, flags=re.S | re.I)
    t = re.sub(r"<(br|/p|/div|/tr|/li|/h[1-6])\s*/?>", "\n", t, flags=re.I)
    t = re.sub(r"<li[^>]*>", "\n- ", t, flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    t = unescape(t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n[ \t]*\n+", "\n\n", t)
    return t.strip()


# The Gmail connector does not always return an empty string for a message
# with no text/plain part — confirmed against real Axial transactional mail,
# where plaintextBody comes back as the literal sentinel string
# "No Text Available" while htmlBody carries the entire message. That is
# non-empty, so the plaintext branch below wins and the whole HTML body is
# discarded. For that one email the practical result was harmless (a
# transactional notice that yields no listings either way), but any real
# deal alert arriving HTML-only through this connector would be reduced to
# the 18-character sentinel and silently produce zero listings — the exact
# failure mode strip_html() was written to prevent, reintroduced one layer
# up. Treat the sentinel as "no plaintext" and fall through to the HTML.
_NO_PLAINTEXT_SENTINELS = {"no text available"}

def best_body(plaintext: Optional[str], html: Optional[str]) -> str:
    """Prefer plaintext; fall back to a stripped HTML body. Confirmed
    necessary against real mail, not a hypothetical."""
    if (plaintext and plaintext.strip()
            and plaintext.strip().lower() not in _NO_PLAINTEXT_SENTINELS):
        return plaintext
    return strip_html(html or "")

# =====================================================================
# 1. SCHEMA
# =====================================================================

@dataclass
class RawEmail:
    msg_id: str
    sender: str
    subject: str
    received: str
    body: str = ""     # HTML already stripped to text

@dataclass
class Listing:
    ext_id: str
    title: str
    blurb: str
    # Attribution triad (organizational contract — keep these three aligned
    # everywhere: pipeline, DB, Flow App, docs):
    #   source     = sender domain          e.g. bizbuysell.com
    #   sub_source = sender email address   e.g. bizalert@bizbuysell.com
    #   nickname   = human-facing label     e.g. BizBuySell
    # UI may truncate/display these; storage always keeps the full values.
    # format_family is INTERNAL only — picks the splitter / ext_id prefix;
    # it is not a substitute for source.
    source: str
    sub_source: str = ""
    nickname: str = ""
    format_family: str = ""
    source_msg: str = ""
    url: str = ""
    city: Optional[str] = None
    state: Optional[str] = None
    county: Optional[str] = None
    revenue: Optional[float] = None
    # EBITDA and SDE are stored SEPARATELY and never collapsed. They are
    # different numbers measuring different things; SDE includes owner comp.
    # Storing one "earnings" field with a flag loses information the moment
    # a listing publishes both.
    ebitda: Optional[float] = None
    sde: Optional[float] = None
    asking: Optional[float] = None
    business_model_type: str = ""
    needs_llm: List[str] = field(default_factory=list)
    seen_in: List[str] = field(default_factory=list)  # domains
    # (source_domain, msg_id, url) for EVERY email that mentioned this deal.
    refs: List[tuple] = field(default_factory=list)
    dupe_of: Optional[str] = None

    @property
    def earnings(self) -> Optional[float]:
        """Prefer EBITDA; fall back to SDE."""
        return self.ebitda if self.ebitda is not None else self.sde

    @property
    def earnings_basis(self) -> Optional[str]:
        if self.ebitda is not None: return "EBITDA"
        if self.sde is not None:    return "SDE"
        return None

    def earnings_display(self) -> str:
        v = self.earnings
        if v is None: return "—"
        return f"${v:,.0f}" + ("*" if self.earnings_basis == "SDE" else "")

    def fingerprint(self) -> str:
        """Deliberately lossy. Same economics + same state = same deal,
        even when four newsletters give it four different headlines."""
        def band(v, step):
            return int(v / step) if v else -1
        raw = f"{self.state}|{band(self.revenue,250_000)}|{band(self.earnings,100_000)}"
        return hashlib.md5(raw.encode()).hexdigest()[:12]


# =====================================================================
# 2. ATTRIBUTION + FORMAT FAMILY
# =====================================================================
#
# Stored on every listing (and Flow App):
#   source     = sender domain
#   sub_source = sender email address
#   nickname   = human-facing label for the source
#
# format_family is NOT stored as "source". It only selects the splitter /
# health baseline / ext_id prefix. See docs/deal-format-repertoire.md.

FORMAT_FAMILY_RULES = [
    ("bizbuysell", [r"bizbuysell\.com", r"bizalert",
                    r"\bnew business matches?\b",
                    r"(?i)^business for sale:"]),
    ("axial",      [r"axial\.(net|com)", r"axialmarket"]),
    ("bizquest",   [r"bizquest\.com"]),
    ("dealstream", [r"dealstream\.com"]),
    ("businessexits", [r"businessexits\.com"]),
    # benchmarkintl.com + regional affiliates (benchmarktennessee.com, …)
    ("benchmark",  [r"benchmark[a-z0-9]*\.com"]),
]

# SOURCE_RULES kept as an alias so older call sites / docs snippets still grep.
SOURCE_RULES = FORMAT_FAMILY_RULES

NICKNAME_RULES = [
    (r"smbdealdigest\.co", "SMB Deal Digest"),
    (r"smbdealhunter\.xyz", "SMB Deal Hunter"),
    (r"smbdealexchange\.com", "SMB Deal Exchange"),
    (r"gulfcoastma\.com", "Gulf Coast M&A"),
    (r"gatewayma\.com", "Gateway M&A"),
    (r"vanlagroup\.com", "Vanla Group"),
    (r"businessexits\.com", "BusinessExits"),
    (r"benchmarktennessee\.com", "Benchmark International (TN)"),
    (r"benchmarkintl\.com", "Benchmark International"),
    (r"benchmark[a-z0-9]*\.com", "Benchmark International"),
    (r"doeren\.com", "Doeren Mayhew (non-deal)"),
    (r"agencyequity\.com", "AgencyEquity"),
    (r"bizbuysell\.com", "BizBuySell"),
    (r"axial\.(net|com)", "Axial"),
    (r"bizquest\.com", "BizQuest"),
    (r"dealstream\.com", "DealStream"),
]

# Personal / catcher inboxes used to forward deals into dirk@. Never treat
# these as the deal provider — look at the original sender or body domains.
FORWARDER_DOMAINS = {
    "tullyinvesting.com",
    "gmail.com", "googlemail.com",
    "hotmail.com", "outlook.com", "live.com", "msn.com",
    "yahoo.com", "ymail.com",
    "icloud.com", "me.com", "mac.com",
}
# Click-tracking hosts that appear in bodies but are not providers.
TRACKING_DOMAIN_CORES = {
    "crmact", "elink", "mailchimp", "sendgrid", "hubspot",
    "constantcontact", "klaviyo", "beehiiv",
}

_DOMAIN = re.compile(r"@([\w.-]+\.[a-z]{2,})", re.I)
_EMAIL_ADDR = re.compile(r"[\w.+-]+@[\w.-]+\.[a-z]{2,}", re.I)
_FORWARD_FROM = re.compile(
    r"^-+\s*Forwarded message\s*-+\s*^From:\s*(.+)$",
    re.I | re.M,
)
_BODY_DOMAIN = re.compile(
    r"(?:https?://(?:www\.)?|@)([\w.-]+\.[a-z]{2,})",
    re.I,
)


def _email_domain(sender: str) -> Optional[str]:
    m = _DOMAIN.search((sender or "").lower())
    return m.group(1).lower() if m else None


def _parse_email_addr(sender: str) -> str:
    """Bare address from a From: header / Forwarded-From line."""
    from email.utils import parseaddr
    _, addr = parseaddr(sender or "")
    addr = (addr or "").strip().lower()
    if addr and "@" in addr:
        return addr
    m = _EMAIL_ADDR.search(sender or "")
    return m.group(0).lower() if m else ""


def _domain_core(domain: str) -> str:
    parts = domain.lower().split(".")
    return parts[-2] if len(parts) >= 2 else domain


def _forwarded_original_from(body: str) -> str:
    """Gmail 'Forwarded message' block — the broker, not the human forwarder."""
    m = _FORWARD_FROM.search(body or "")
    return m.group(1).strip() if m else ""


def _is_provider_domain(domain: str) -> bool:
    if not domain:
        return False
    d = domain.lower()
    if d in FORWARDER_DOMAINS:
        return False
    core = _domain_core(d)
    if core in TRACKING_DOMAIN_CORES or core in {"tullyinvesting"}:
        return False
    return True


def nickname_for(domain: str, email: str = "", hay: str = "") -> str:
    """Human-facing label for a provider domain / address."""
    blob = f"{email} {domain} {hay}".lower()
    for pat, name in NICKNAME_RULES:
        if re.search(pat, blob):
            return name
    if domain and _is_provider_domain(domain):
        return _domain_core(domain).capitalize()
    return "Unknown"


def format_family(em: RawEmail) -> str:
    """Internal splitter key — NOT the stored `source` field."""
    hay = f"{em.sender} {em.subject} {em.body[:8000]}".lower()
    for fam, pats in FORMAT_FAMILY_RULES:
        if any(re.search(p, hay) for p in pats):
            return fam
    return "newsletter"


def route(em: RawEmail) -> str:
    """Alias for format_family() — kept for older scripts."""
    return format_family(em)


def attribution(em: RawEmail) -> Tuple[str, str, str]:
    """Return (source_domain, sub_source_email, nickname).

    Never attribute a forwarder's personal mailbox when the original provider
    is recoverable from a Forwarded message block or body domains.
    """
    original = _forwarded_original_from(em.body)
    hay = f"{original} {em.sender} {em.subject} {em.body[:8000]}"

    email, domain = "", ""
    for candidate in (original, em.sender):
        if not candidate:
            continue
        e = _parse_email_addr(candidate)
        d = _email_domain(e) or _email_domain(candidate) or ""
        if _is_provider_domain(d):
            email, domain = e, d
            break

    if not domain:
        for d in _BODY_DOMAIN.findall(em.body or ""):
            if _is_provider_domain(d):
                domain = d.lower()
                break

    if not domain:
        # Last resort: whatever is on the envelope (even a forwarder).
        email = _parse_email_addr(em.sender)
        domain = _email_domain(email) or _email_domain(em.sender) or "unknown"

    if not email and original:
        email = _parse_email_addr(original)
    if not email:
        email = _parse_email_addr(em.sender)

    nick = nickname_for(domain, email, hay)
    return domain, email, nick


def sub_source(em: RawEmail) -> str:
    """Sender email address (sub_source). Prefer attribution()[1]."""
    return attribution(em)[1]


# =====================================================================
# 3. SPLIT — digest -> listing blocks
# =====================================================================

# Franchise block often arrives with the heading split across lines after
# HTML→text ("The following franchises\n…\nmatch your search criteria").
FRANCHISE_SECTION = re.compile(
    r"following\s+franchises[\s\S]{0,120}?match your search criteria", re.I
)

# Verified against live BizAlert mail (converted from HTML — BizBuySell
# sends no plaintext body at all). Two layouts appear in the wild:
#   (A) label and value on separate lines (older):
#         Title
#         Asking Price:
#         $214,000
#         Location:
#         Austin, TX
#   (B) label and value on one line (Gmail HTML strip / Fwd, 2026-07):
#         Title
#         <https://www.bizbuysell.com/listings/...>
#         Asking Price:   $550,000
#         Location: TX
# Optional URL line(s) between title and Asking are common after strip_html
# keeps hrefs. Alerts still carry NO earnings — asking + location only.
# Franchise section is bundled even when franchises are excluded from the
# search, so it's dropped via FRANCHISE_SECTION rather than buy-box.
BIZALERT_LISTING = re.compile(
    # Gmail HTML→text often emits the listing URL on its own line ABOVE the
    # title as well as below it. Allow optional URL lines on either side.
    # Use \r?\n — Gmail API bodies are CRLF; a bare \n+ after '>' fails to
    # consume the line ending, the URL-skipper matches nothing, and the title
    # group then swallows a mangled URL (observed as title 'ttps://...').
    #
    # Title cap was 160 and that truncated live BizAlert lines: strip_html
    # glues "(https://www.bizbuysell.com/listings/Profile/?…long utm…)" onto
    # the business name (~200+ chars). The engine then started mid-word
    # ("rations", "usiness", "rovider") so every Texas digest came back
    # broken. Cap is high enough for name + URL; TRAILING_LINK peels the URL.
    r"(?:<?https?://[^\s>]+>?\r?\n+)*"
    r"(?P<title>(?!<?https?://)[^\r\n]{5,500}?)\r?\n+"
    r"(?:<?https?://[^\s>]+>?\r?\n+)*"
    r"\s*Asking Price:\s*(?:\r?\n+\s*)?(?P<price>[^\r\n]+?)\r?\n+"
    r"\s*Location:\s*(?:\r?\n+\s*)?(?P<loc>[^\r\n]+)",
    re.I,
)

# The title itself is a hyperlink in the source HTML, so strip_html's
# href-preservation appends " (https://...)" right onto the title line.
# Pull that back out onto its own line rather than leaving it glued to the
# title text — extract_title would otherwise store the URL as part of the
# business name, and the generic URL regex only takes the FIRST link in a
# block, which happens to be this one anyway, but a clean title matters for
# the report and for title-similarity dedupe.
TRAILING_LINK = re.compile(r"\s*\((https?://[^\s)]+)\)\s*$")

def split_bizbuysell(body: str) -> List[str]:
    body = FRANCHISE_SECTION.split(body)[0]
    # Peel glued "(https://listings/...)" onto its own line before matching
    # so the title group never has to swallow a 200-char tracking URL.
    body = re.sub(
        r"([^\r\n]{5,240}?)\s*\((https?://www\.bizbuysell\.com/listings/[^)]+)\)",
        r"\1\n\2",
        body,
        flags=re.I,
    )
    out = []
    for m in BIZALERT_LISTING.finditer(body):
        title = m.group("title").strip()
        price = m.group("price").strip()
        loc = m.group("loc").strip()
        # Franchise leftovers that escaped the section cut.
        if re.search(r"available in a location near you", loc, re.I):
            continue
        if re.match(r"<?https?://", title, re.I):
            continue
        if re.search(r"businesses recently posted|search criteria|search all business", title, re.I):
            continue
        # Mid-word leftovers if a glue peel ever fails ("rations", "usiness").
        if len(title) < 20 and title[:1].islower():
            continue
        url = ""
        lm = TRAILING_LINK.search(title)
        if lm:
            url = lm.group(1)
            title = TRAILING_LINK.sub("", title).strip()
        # Prefer the listing Profile URL that sits between title and Asking
        # in layout (B); first https in the match span works.
        if not url:
            um = re.search(r"https?://www\.bizbuysell\.com/listings/[^\s>)]+", m.group(0))
            if um:
                url = um.group(0).rstrip(">")
        # Re-normalize onto single lines so the generic (source-agnostic)
        # extractor — which expects label and value close together on one
        # line — can read it without a BizBuySell-specific code path.
        # Price lines sometimes arrive as a bare NBSP; keep looking for $.
        if not re.search(r"\$", price):
            continue
        block = f"{title}\nAsking Price: {price}\nLocation: {loc}"
        if url:
            block += f"\n{url}"
        out.append(block)
    return out

def split_axial(body: str) -> List[str]:
    """Axial alerts use a numbered / rule-separated deal list.

    The MONEY_SIGNAL requirement is not cosmetic. Axial also sends ordinary
    transactional mail from the same domain — confirmed against a real
    "Updated Email Address" notice from notifications@axial.net, which
    routes to this splitter because FORMAT_FAMILY_RULES matches the sender domain,
    not the message type. It contains no separators, so the entire notice
    came through as one >80-char part and became a phantom listing titled
    "Your Email Address Has Changed" with no money and no location. Every
    genuine Axial deal alert carries Revenue/EBITDA figures inline (see the
    fixture below), so requiring a money signal drops account notices
    without touching real alerts. Matches what split_newsletter already
    does for the same reason."""
    parts = re.split(r"\n\s*(?:-{3,}|={3,}|\d+\.\s)", body)
    return [p for p in parts if len(p.strip()) > 80 and MONEY_SIGNAL.search(p)]

MONEY_SIGNAL = re.compile(r"\$[\d,.]+\s*(?:[KMB]|million)?|\b(?:EBITDA|SDE|revenue|cash flow)\b", re.I)

def _only_financials(p: str) -> bool:
    """True when a paragraph is a bare stat block ('Revenue: $6.4M' /
    'EBITDA: $1.05M') with no headline of its own.

    Bug found against real Benchmark International mail: its Financial
    Summary lines are "TY 2025 Revenue: $3.5M" / "TY 2023 Adj. EBITDA:
    $238K" — a fiscal-year digit prefix inside the label. The label
    character class excluded digits entirely, so neither line matched,
    _only_financials returned False, the block never got its headline
    reattached, and — being only ~50 chars on its own — it then failed the
    split_newsletter minimum-block-size floor and was DROPPED silently. A
    real listing with real EBITDA vanished with no error and no health
    alert (it isn't a new source going to zero, it's a per-listing loss
    inside one still-working source). Allow digits/periods in the label."""
    lines = [l.strip() for l in p.strip().split("\n") if l.strip()]
    if not lines: return False
    statish = sum(bool(re.match(r"^[A-Za-z0-9'.\s]{3,40}:\s*\$", l)) for l in lines)
    return statish >= max(2, len(lines) * 0.6)

# Verified against a live Vanla Group email: broker teaser blasts spread one
# listing's title, location, financial summary, and blurb across five-plus
# separate blank-line-delimited paragraphs, in no fixed order relative to
# each other. Paragraph-by-paragraph splitting fragments this into useless
# pieces (a "listing" that's just "Delaware Valley, Philadelphia" with no
# price attached). These emails are reliably one-listing-per-email, so when
# the teaser markers below are present, treat the WHOLE body as a single
# block instead of trying to split it.
BROKER_TEASER_MARKERS = [
    r"sign\s+(?:the\s+)?nda",
    r"confidential\s+information\s+memorandum",
    r"\bcim\b",
    r"listing\s*id\s*:",
    # Asking + Revenue often sit on separate lines in broker one-pagers.
    r"asking\s*price\s*:[\s\S]{0,120}?\brevenue\s*:",
]
OTHER_LISTINGS_BOUNDARY = re.compile(r"other\s+[\w']+\s+listings", re.I)

def _is_single_listing_teaser(body: str) -> bool:
    return any(re.search(p, body, re.I) for p in BROKER_TEASER_MARKERS)


def _strip_forward_chrome(body: str) -> str:
    """Drop the human forwarder's sig; keep the original broker message."""
    m = re.search(r"^-+\s*Forwarded message\s*-+\s*", body or "", re.I | re.M)
    if not m:
        return body
    rest = body[m.end():]
    # Skip From/Date/Subject/To header block that follows the marker.
    parts = re.split(r"\n\s*\n", rest, maxsplit=1)
    return parts[1] if len(parts) == 2 else rest


# Verified against a live SMB Deal Hunter email: it presents each deal TWICE
# — once as a clean one-line entry in an "In Today's Issue" list near the
# top (title + rough state + EBITDA, all inline), and again lower down as a
# scattered multi-paragraph "card" (Location: / Multiple: / "My 2 Cents:"
# commentary as separate blank-line blocks). Generic paragraph splitting
# can't safely re-stitch the second form back into one record per deal —
# it produced junk entries like a "listing" titled "Location: **Texas" with
# no name attached. The top list alone is a complete, if less detailed,
# record for each deal, so when this shape is detected we use ONLY that and
# deliberately ignore the duplicated detail section below it.
# Bug found against live SMB Deal Hunter mail (2026-07-28 and 2026-07-30
# issues): beehiiv renders the heading with a typographic right single
# quote — "In Today’s Issue" (U+2019), not the ASCII "In Today's Issue" the
# hand-transcribed fixture used. `'?` makes the ASCII apostrophe OPTIONAL,
# it does not make U+2019 acceptable, so the marker failed to match, the
# digest path was skipped entirely, and generic paragraph splitting produced
# junk instead of the 5 real listings. Exactly the silent per-source loss
# NUMBERED_DIGEST_MARKER exists to avoid — and invisible to the health
# check, since the sender still yielded a nonzero (wrong) count. Accept
# either apostrophe character, and keep both optional so "In Todays Issue"
# still matches.
# Prefer the digest heading itself. A looser "in today's … issue" also
# matches beehiiv chrome like "in today's Off The Grid issue" that appears
# BEFORE the real list in forwarded mail — those false hits used to make us
# think we had a digest, then search the wrong window and fall through.
NUMBERED_DIGEST_MARKER = re.compile(
    r"(?:👇\s*)?\*?in today[’']?s issue\b", re.I
)
NUMBERED_ITEM_START = re.compile(r"^#(\d+):\s*(.*)$")

def _numbered_digest_items(body: str) -> List[str]:
    """Pull only the #1/#2/… teaser list under 'In Today's Issue'.

    Bug found against Gmail Fwds of SMB Deal Hunter (2026-07-30): the digest
    heading sat past character 3000 because the forward wrapper + beehiiv
    chrome prepend a long header. The old code required the marker somewhere
    in the body, then searched ONLY body[:3000] for #N items — marker hit,
    items missed, empty list, fallthrough to paragraph junk. Fix: find the
    marker, then parse #N items in a window AFTER it. Titles often wrap onto
    the next line(s) before the listing URL ('#2: … $910K' / 'EBITDA'), so
    continuation lines are folded into the same block.
    """
    m = NUMBERED_DIGEST_MARKER.search(body)
    if not m:
        return []
    # Intro list is short; detail cards / "My 2 Cents" live further down.
    window = body[m.end(): m.end() + 3500]
    items: List[str] = []
    cur_n: Optional[str] = None
    cur_lines: List[str] = []

    def flush():
        nonlocal cur_n, cur_lines
        if cur_n is None:
            return
        text = " ".join(s.strip() for s in cur_lines if s.strip())
        # Markdown links first — stripping the URL alone leaves "[Title](" crumbs.
        text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
        # Drop bare URL continuation lines / trailing <https://...> crumbs.
        text = re.sub(r"<?https?://[^\s>]+>?", " ", text)
        text = re.sub(r"\s+", " ", text).strip(" -|")
        # Do not re-prefix "#N:" — extract_title already strips list numbers, but
        # the blurb used to keep them (#2: Automotive…) and show junk in the UI.
        if text:
            items.append(text)
        cur_n, cur_lines = None, []

    for line in window.splitlines():
        s = line.strip()
        start = NUMBERED_ITEM_START.match(s)
        if start:
            flush()
            cur_n = start.group(1)
            cur_lines = [start.group(2)]
            continue
        if cur_n is None:
            continue
        # End of the intro list.
        if re.search(r"looking for deals in your area|proudly sponsored|my 2 cents", s, re.I):
            flush()
            break
        if not s:
            continue
        # Keep URL / title wrap lines; stop if a new section heading appears.
        if s.startswith("📍") or s.lower().startswith("location:"):
            flush()
            break
        cur_lines.append(s)
    flush()
    return items

def _is_smb_deal_hunter(body: str, sender: str = "") -> bool:
    # Sender matters: some HTML→text bodies drop the branded domain while
    # From: is still helen@mail.smbdealhunter.xyz. Body-only detection then
    # missed the guard and fell through to paragraph splitting.
    return bool(re.search(
        r"smbdealhunter\.xyz|smb deal hunter",
        f"{sender}\n{body}",
        re.I,
    ))


_SMB_FIELD_START = re.compile(
    r"^(?:📍\s*)?(?:location|revenue|ebitda|sde|asking|multiple|cash flow)\s*:",
    re.I,
)
_SMB_CHROME = re.compile(
    r"looking for deals in your area|proudly sponsored|unsubscribe|"
    r"in today[’']?s issue|off the grid",
    re.I,
)


def _smb_detail_cards(body: str) -> List[str]:
    """Stitch SMB Deal Hunter detail cards into one block per deal.

    Live shape (verified 2026-07-31 against split 'Location: *Texas' junk):
        <title … $910K EBITDA>
        <blank>
        Location: *Texas
        <blank>
        Revenue: $7.0M
        EBITDA: $910K
        Multiple: …

    Generic blank-line splitting treated the title as one listing and the
    Location+stats reattachment as another titled "Location: *Texas". Only
    return blocks when a title actually absorbed a Location/stat follow-on,
    so a digest-list-only email still falls through to _numbered_digest_items.
    """
    parts = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    blocks: List[str] = []
    i = 0
    while i < len(parts):
        p = parts[i]
        if _SMB_CHROME.search(p) or NUMBERED_ITEM_START.match(p):
            i += 1
            continue
        if _SMB_FIELD_START.match(p) or _only_financials(p):
            i += 1
            continue
        if not MONEY_SIGNAL.search(p) or len(p) < 40:
            i += 1
            continue

        chunk = [p]
        absorbed = False
        j = i + 1
        while j < len(parts):
            nxt = parts[j]
            if _SMB_CHROME.search(nxt) or NUMBERED_ITEM_START.match(nxt):
                break
            if re.match(r"my 2 cents", nxt, re.I):
                chunk.append(nxt)
                j += 1
                break
            if _SMB_FIELD_START.match(nxt) or _only_financials(nxt):
                chunk.append(nxt)
                absorbed = True
                j += 1
                continue
            # Short labeled field lines ("Employees: 12") belong on the card.
            if re.match(r"^[A-Za-z0-9'.\s]{3,40}:\s*", nxt) and len(nxt) < 160:
                chunk.append(nxt)
                absorbed = True
                j += 1
                continue
            # Next title-sized money paragraph → new deal.
            if MONEY_SIGNAL.search(nxt) and len(nxt) >= 40 and not _only_financials(nxt):
                break
            break

        if absorbed:
            block = "\n\n".join(chunk)
            if len(block) >= 60:
                blocks.append(block)
            i = j
        else:
            i += 1
    return blocks


def split_newsletter(body: str, sender: str = "") -> List[str]:
    """Newsletters are the wild west. Blank-line blocks, keeping only those
    that look like a deal — but a bare stat block has its headline in the
    PRECEDING paragraph, so reattach it. Without this the title extracts as
    'Revenue: $6,400,000' and the location is lost entirely."""
    # SMB before broker-teaser: digests can mention revenue near other labels
    # and must not collapse into a single one-pager block.
    if _is_smb_deal_hunter(body, sender):
        cards = _smb_detail_cards(body)
        if cards:
            return cards
        digest_items = _numbered_digest_items(body)
        if digest_items:
            return digest_items
        return []

    if _is_single_listing_teaser(body):
        primary = OTHER_LISTINGS_BOUNDARY.split(_strip_forward_chrome(body))[0]
        if MONEY_SIGNAL.search(primary):
            return [primary]

    digest_items = _numbered_digest_items(body)
    if digest_items:
        return digest_items

    parts = [p for p in re.split(r"\n\s*\n", body)]
    out, consumed = [], set()
    for i, p in enumerate(parts):
        if len(p.strip()) < 40 or not MONEY_SIGNAL.search(p):
            continue
        block, start = p, i
        if _only_financials(p):
            # Window widened 2 -> 6 paragraphs back: real Benchmark
            # International broker mail puts "Tristan, / We are
            # representing a Glass & Glazing... / Here's a summary... /
            # Location: ... / Description: ... / Current Markets: ... /
            # Financial Summary: / TY 2025 Revenue: $X" as SEVEN separate
            # blank-line paragraphs, with the actual headline six
            # paragraphs before the money block. The short-paragraph
            # break (<10 chars) still stops at a bare "Tristan," greeting,
            # and the MONEY_SIGNAL break still stops at a competing
            # financial block, so this is safe for the tighter fixtures
            # (New Braunfels only needed 2) while fixing the Benchmark case.
            for j in range(i - 1, max(-1, i - 7), -1):
                if j in consumed or j < 0: break
                prev = parts[j]
                if MONEY_SIGNAL.search(prev) or len(prev.strip()) < 10: break
                block, start = prev + "\n" + block, j
        for k in range(start, i + 1):
            consumed.add(k)
        if len(block.strip()) >= 60:
            out.append(block)
    return out

SPLITTERS = {
    "bizbuysell": split_bizbuysell,
    "axial": split_axial,
    "bizquest": split_bizbuysell,
    "dealstream": split_newsletter,
    "businessexits": split_newsletter,
    "benchmark": split_newsletter,
    "newsletter": split_newsletter,
}


# =====================================================================
# 4. EXTRACT
# =====================================================================

# Real Vanla Group listings write "SDE: $~262k (TTM)" — a tilde/approx marker
# between the $ and the digits. The original pattern required digits right
# after $ and missed this entirely.
#
# Bug found against the New Braunfels fixture: the space before the optional
# unit suffix was `\s*`, which matches '\n'. "$6,400,000\nAdjusted EBITDA"
# let MONEY silently swallow the newline while scanning for a K/M/B unit
# that wasn't there — making a backward label search see a fake zero-gap
# match across a line break that should have blocked it entirely. `[ \t]*`
# keeps the unit suffix same-line only.
#
# Second bug, found chasing the first one: the unit alternation tried
# `[KMB]` (a single-char class) BEFORE `million`/`billion`. Regex
# alternation is first-match-wins, not longest-match — so on "$3 million",
# `[KMB]` matched just the leading "m" and left "illion in " to spill into
# whatever pattern came next. parse_money still computed the right dollar
# value (bare "m" and "million" are treated the same there), but the
# leftover "illion" text inflated the measured gap length in
# _closest_money_for_label, making a CORRECT match look farther away than
# a wrong one and lose the "smallest gap wins" comparison. Multi-letter
# words must be tried before the single-letter class.
MONEY = r"\$\s?(?:~|≈|approx\.?\s?)?\s?([\d,]+(?:\.\d+)?)[ \t]*(million|billion|mm|[KMB])?"

def parse_money(num: str, unit: Optional[str]) -> float:
    v = float(num.replace(",", ""))
    u = (unit or "").lower()
    if u in ("k",):                     v *= 1_000
    elif u in ("m", "mm", "million"):   v *= 1_000_000
    elif u in ("b", "billion"):         v *= 1_000_000_000
    return v

# Each field gets its own label set and its own column.
#
# RULE OF THUMB (per Tristan): ambiguous earnings labels are SDE, not EBITDA.
# "Cash Flow" on BizBuySell is SDE — it includes owner comp. Filing an
# ambiguous number as EBITDA overstates the business; filing it as SDE is
# the conservative error, and the annotation makes the uncertainty visible.
EBITDA_PATS = [r"adjusted\s+ebitda", r"normalized\s+ebitda", r"\bebitda\b"]

SDE_PATS = [
    r"seller'?s?\s+discretionary\s+earnings", r"\bSDE\b",
    r"discretionary\s+earnings", r"\bDE\b",
    r"cash\s*flow",              # BizBuySell's label — always SDE
    r"owner\s+benefit", r"owner'?s?\s+earnings", r"net\s+to\s+owner",
    r"seller'?s?\s+earnings", r"adjusted\s+net", r"owner\s+profit",
    # businessexits.com labels its earnings figure bare "Profit" (e.g.
    # "Profit (2025): $850K") with no EBITDA/SDE qualifier at all. Same
    # ambiguous-label rule applies as BizBuySell's "Cash Flow": file as SDE,
    # never guess it into the EBITDA column. Bounded so it doesn't eat
    # "net profit margin" commentary elsewhere in a blurb.
    r"\bprofit\b(?!\s+margin)",
]

REVENUE_PATS = [r"total\s+revenue", r"gross\s+revenue", r"annual\s+revenue",
                r"\brevenue\b", r"gross\s+sales", r"annual\s+sales", r"\bsales\b"]

ASKING_PATS = [r"asking\s+price", r"\basking\b", r"purchase\s+price",
               r"list\s+price", r"\bprice\b"]

FIELD_PATS = [
    ("ebitda",  EBITDA_PATS),
    ("sde",     SDE_PATS),
    ("revenue", REVENUE_PATS),
    ("asking",  ASKING_PATS),
]

# Bug found against a real Vanla listing: "...approximately $3 million in
# annual revenue and ~$262,000 in Seller's Discretionary Earnings." The old
# code took the FIRST label-then-nearby-$ match and stopped. "annual revenue"
# sits right before the SDE dollar figure in that sentence, so revenue got
# filed as $262,000 — the SDE number — while the real $3M revenue (which
# appeared BEFORE the label, not after) was never tried. Fix: gather every
# candidate match for a field, reject any whose gap crosses into another
# field's vocabulary (before OR after the money), and keep the closest one
# that isn't contaminated — rather than the first one regex happens to find.
OTHER_FIELD_MARKERS = {
    "ebitda":  ["sde", "discretionary", "revenue", "sales", "asking", "price"],
    "sde":     ["ebitda", "revenue", "sales", "asking", "price"],
    "revenue": ["ebitda", "sde", "discretionary", "asking", "price"],
    "asking":  ["ebitda", "sde", "discretionary", "revenue", "sales"],
}

def _crosses_other_field(span: str, markers: List[str]) -> bool:
    return any(re.search(rf"\b{m}\b", span, re.I) for m in markers)

def _closest_money_for_label(text: str, label_pat: str, markers: List[str],
                              fwd_gap: int = 40, bwd_gap: int = 25):
    """Best (smallest-gap) money match for one label pattern, in either
    direction, discarding any candidate whose gap text itself names a
    competing field. "Smallest gap wins" is the actual discriminator for
    the Vanla case (revenue's true $3M sits 4 chars before its label;
    the wrong $262K SDE figure sits 6 chars after it) — an earlier version
    also rejected candidates via a fixed-window lookahead past the money,
    but that over-fired on one-field-per-line formats (New Braunfels
    fixture) where the NEXT field's label always appears shortly after by
    construction, incorrectly discarding a valid same-line match."""
    best = None  # (gap_len, value)
    for m in re.finditer(label_pat + r"([^\n$]{0,%d}?)" % fwd_gap + MONEY, text, re.I):
        gap = m.group(1)
        if _crosses_other_field(gap, markers):
            continue
        val = parse_money(m.group(2), m.group(3))
        if best is None or len(gap) < best[0]:
            best = (len(gap), val)
    # businessexits.com's "Key Metrics Grid" format (confirmed against real
    # mail) puts the label alone on its own line, then a blank line, then
    # the dollar figure alone on the next: "Revenue (2025)\n\n$3,256,592".
    # The same-line search above requires [^\n$] in the gap and can never
    # bridge that — it returned {} for every field on every businessexits.com
    # listing, not just "Profit". Bridge up to 2 blank lines specifically
    # (not an unbounded newline-tolerant gap) so a same-line match elsewhere
    # in the document can't get bypassed by a coincidentally-close label on
    # an unrelated later line.
    # Parenthetical after the label can run longer than a bare year — real
    # example: "Profit (2025- both companies combined)" on the Pennsylvania
    # landscaping listing. 20 chars truncated that mid-parenthetical and
    # missed both Revenue and Profit on that email; 60 comfortably covers it.
    for m in re.finditer(label_pat + r"[ \t]*(?:\([^)\n]{0,60}\))?[ \t]*\n(?:[ \t]*\n){0,2}[ \t]*" + MONEY,
                          text, re.I):
        # gap here is pure whitespace/newlines by construction (nothing to
        # scan for a competing field name) — rank it behind any same-line
        # match but ahead of no match at all.
        val = parse_money(m.group(1), m.group(2))
        if best is None:
            best = (999, val)
    for m in re.finditer(MONEY + r"([^\n$]{0,%d}?)" % bwd_gap + label_pat, text, re.I):
        gap = m.group(3)
        if _crosses_other_field(gap, markers):
            continue
        val = parse_money(m.group(1), m.group(2))
        if best is None or len(gap) < best[0]:
            best = (len(gap), val)
    return best

def extract_money_fields(text: str) -> Dict[str, float]:
    """Label-anchored money extraction. A bare '$395,000' with no nearby
    label is NOT assigned to a field — an unlabeled number guessed into the
    earnings slot is exactly how a $395K asking price becomes a Tier 3 deal.

    EBITDA and SDE are extracted independently. A listing publishing both
    populates both columns."""
    found: Dict[str, float] = {}
    for field_name, pats in FIELD_PATS:
        markers = OTHER_FIELD_MARKERS[field_name]
        best = None
        for p in pats:
            cand = _closest_money_for_label(text, p, markers)
            if cand and (best is None or cand[0] < best[0]):
                best = cand
        if best:
            found[field_name] = best[1]
    return found


STATES = {"AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
          "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
          "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
          "VA","WA","WV","WI","WY","DC"}

# Real gap found against businessexits.com and Benchmark Tennessee mail: both
# spell states out in full prose ("Location: Pennsylvania, United States",
# "situated in Virginia and Kentucky", "swimwear company in California") with
# no 2-letter abbreviation anywhere in the block. The abbreviation-only
# matcher above returns state=None for every one of these — not a crash, but
# a silent miss that needs_llm should be catching and wasn't, because there
# was no full-name lookup to fail out of in the first place. Sorted longest
# name first so "New Hampshire" matches before a hypothetical shorter prefix
# would.
STATE_NAMES = {
    "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA",
    "colorado":"CO","connecticut":"CT","delaware":"DE","florida":"FL","georgia":"GA",
    "hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS",
    "kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA",
    "michigan":"MI","minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT",
    "nebraska":"NE","nevada":"NV","new hampshire":"NH","new jersey":"NJ","new mexico":"NM",
    "new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK",
    "oregon":"OR","pennsylvania":"PA","rhode island":"RI","south carolina":"SC",
    "south dakota":"SD","tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT",
    "virginia":"VA","washington":"WA","west virginia":"WV","wisconsin":"WI","wyoming":"WY",
}
_STATE_NAME_PAT = re.compile(
    r"\b(" + "|".join(sorted(STATE_NAMES, key=len, reverse=True)) + r")\b", re.I
)

def extract_location(text: str):
    city = state = county = None
    m = re.search(r"([A-Z][A-Za-z.\-/' ]{2,28}?)[ \t]+County,[ \t]*([A-Z]{2})\b", text)
    if m and m.group(2) in STATES:
        return None, m.group(2), m.group(1).strip()
    # [ \t] not \s — \s crosses newlines and swallows the preceding line
    # ("Plumbing Company\nGeorgetown, TX" parsed city as "Plumbing Company").
    for m in re.finditer(r"(?:^|[^A-Za-z\n])([A-Z][A-Za-z.\-/']+(?:[ \t]+[A-Z][A-Za-z.\-/']+){0,2}),[ \t]*([A-Z]{2})\b", text, re.M):
        if m.group(2) in STATES:
            city, state = m.group(1).strip(), m.group(2)
            break
    if not state:
        m = re.search(r"\b(" + "|".join(STATES) + r")\b", text)
        if m: state = m.group(1)
    if not state:
        m = _STATE_NAME_PAT.search(text)
        if m: state = STATE_NAMES[m.group(1).lower()]
    return city, state, county


LOCAL_SIGNALS = [r"\bhvac\b", r"plumbing", r"electrical", r"roofing", r"landscap",
                 r"janitorial", r"pest control", r"home service", r"residential",
                 r"route[- ]based", r"service area", r"crews?\b", r"technicians?\b",
                 r"\bclinic\b", r"\bpractice\b", r"local customers"]
# Entire state / a handful of states — not one metro, not coast-to-coast.
REGIONAL_SIGNALS = [
    r"\bregional\b",
    r"multi[- ]state",
    r"\bstates?wide\b",
    r"\btri[- ]state\b",
    r"(?:across|throughout|serving|in)\s+(?:the\s+)?(?:entire\s+)?state\b",
    r"(?:two|three|four|five|several|few|[2-9]|1\d)\s+states?\b",
    r"across\s+(?:multiple\s+)?states?\b",
    r"states?\s+of\s+(?:texas|oklahoma|louisiana|arkansas|tennessee|florida|california)",
]
# Truly national footprint — not "regional" and not a single market.
NATIONAL_SIGNALS = [
    r"\bnationwide\b",
    r"\bnationally\b",
    r"ships?\s+nationally",
    r"national\s+customer",
    r"national\s+(?:footprint|platform|presence|scale|network)",
    r"all\s+50\s+states",
    r"coast[- ]to[- ]coast",
    r"across\s+the\s+(?:country|nation|u\.?\s?s\.?a?\.?|united\s+states)",
    r"throughout\s+the\s+(?:country|nation|u\.?\s?s\.?a?\.?|united\s+states)",
]

def classify_model(text: str) -> Tuple[str, bool]:
    """Returns (type, confident).

    Labels: LOCAL_SERVICE | REGIONAL | NATIONAL | "" (blank when unclear).
    Do not invent a fourth 'ambiguous' label — leave the field empty instead.
    """
    t = text.lower()
    loc = sum(bool(re.search(p, t)) for p in LOCAL_SIGNALS)
    reg = sum(bool(re.search(p, t)) for p in REGIONAL_SIGNALS)
    nat = sum(bool(re.search(p, t)) for p in NATIONAL_SIGNALS)

    if nat and nat >= reg:
        return "NATIONAL", nat >= 1 and (reg == 0 or nat > reg)
    if reg:
        return "REGIONAL", True
    if loc:
        return "LOCAL_SERVICE", True
    return "", False


# Verified against real beehiiv-platform mail (SMB Deal Hunter, Vanla
# Group): the naive "first non-blank line" heuristic picked up "View image:",
# a nav bar ("Sign Up | Podcast | Sell Your Business"), or the financial
# summary line ("### Asking: $600,000 | Revenue: $3M | SDE: $~262k") instead
# of the actual headline. All three are common boilerplate on this ESP and
# need to be skipped explicitly rather than assumed away.
NOISE_LINE = re.compile(
    r"^(view image|follow image link|caption|sign nda|sign up|podcast|"
    r"work with me|-{3,}|see the revenue|sponsored|\||new listing|"
    r"sba eligible|partially sba eligible|"
    r"this highly|i am contacting|i'm contacting|we are representing|"
    r"i thought you might|thank you,?$|tristan,?$)",
    re.I,
)

def _is_financial_summary_line(s: str) -> bool:
    """True for a boilerplate stat line like '### Asking: $600,000 |
    Revenue: $3M | SDE: $~262k' — NOT for a normal headline that happens to
    name its financial highlight, e.g. real SMB Deal Hunter digest titles
    like 'Hawaii Tour Operator with Contract-Backed Revenue and $763K SDE'.
    That headline hits two keywords (revenue, sde) same as a real summary
    line, and the old keyword-count-only check filtered it out entirely —
    the ONLY item in a real 5-item digest to come back "(untitled
    listing)", because it was the only headline that happened to use two
    financial words instead of one. A genuine summary line carries multiple
    dollar figures; a headline naming its highlight carries one. Require
    both signals, not just keyword count."""
    hits = sum(bool(re.search(p, s, re.I)) for p in
               [r"\basking\b", r"\brevenue\b", r"\bsde\b", r"\bebitda\b", r"cash\s*flow"])
    return hits >= 2 and s.count("$") >= 2

def extract_title(block: str, subject: str = "") -> str:
    for line in block.strip().split("\n"):
        s = line.strip()
        if not s or re.fullmatch(r"[\$\d,.\sKMB]+", s):
            continue
        if re.fullmatch(r"[\d\s()./+-]{7,}", s):  # phone / fax lines
            continue
        if NOISE_LINE.match(s) or _is_financial_summary_line(s):
            continue
        if re.match(r"^https?://", s, re.I):
            continue
        if re.match(r"^asking price\s*:", s, re.I):
            continue
        s = re.sub(r"^#{1,6}\s*", "", s)             # markdown heading marks
        s = re.sub(r"^#?\d+[:.]\s*", "", s)          # "#1:" / "1." list numbering
        s = re.sub(r"^\*+|\*+$", "", s).strip()      # bold markers
        m = re.match(r"^\[([^\]]+)\]\(([^)]+)\)", s)  # markdown link -> text
        if m:
            s = m.group(1)
        s = re.sub(r"^\W+", "", s)
        # Skip broker prose openers; prefer a real headline / subject below.
        if re.match(
            r"^(this|i am|we are|i'm|dear|hello|hi\b|tristan\b|"
            r"i thought|interested in|similar businesses)\b",
            s,
            re.I,
        ):
            continue
        if len(s) > 6:
            # Long sentence-like lines are broker prose, not listing names.
            # Prefer the email subject when we have one (Gateway / Vanla / etc.).
            if subject and (len(s) > 80 or ". " in s):
                cleaned = re.sub(r"^(?:fwd|fw|re)\s*:\s*", "", subject, flags=re.I).strip()
                cleaned = re.sub(r"\s+", " ", cleaned)
                if len(cleaned) > 6:
                    return cleaned[:110]
            return s[:110]
    # Single-listing broker mail often has the real name only in Subject.
    if subject:
        cleaned = re.sub(r"^(?:fwd|fw|re)\s*:\s*", "", subject, flags=re.I).strip()
        cleaned = re.sub(r"\s+", " ", cleaned)
        if len(cleaned) > 6:
            return cleaned[:110]
    return "(untitled listing)"


_BLURB_URL = re.compile(r"<?(https?://[^\s<>\]]+)>?", re.I)


def _url_core(u: str) -> str:
    """Loose identity for 'same destination as View original listing'."""
    if not u:
        return ""
    u = u.strip().rstrip("/").lower()
    if "#" in u:
        u = u.split("#", 1)[0]
    # Tracking wrappers (SMB Deal Hunter elinks) are never the listing itself.
    if "elink" in u or "mail.smbdealhunter" in u:
        return ""
    if "?" in u:
        base, qs = u.split("?", 1)
        kept = [p for p in qs.split("&") if p and not p.lower().startswith(
            ("utm_", "ref=", "fbclid=", "gclid=", "mc_"))]
        u = base + (("?" + "&".join(kept)) if kept else "")
    return u


def clean_blurb(block: str, listing_url: str = "") -> str:
    """Human-readable blurb: drop digest numbers and tracking/duplicate URLs."""
    text = block.strip()
    text = re.sub(r"^#?\d+[:.]\s*", "", text)
    listing = _url_core(listing_url)

    def repl(m: re.Match) -> str:
        raw = m.group(1)
        core = _url_core(raw)
        if listing and core and core == listing:
            return " "
        # Long tracking / redirect URLs add nothing once we have View original.
        if len(raw) > 60 or "elink" in raw.lower() or "utm_" in raw.lower():
            return " "
        return " "

    text = _BLURB_URL.sub(repl, text)
    text = re.sub(r"\s+", " ", text).strip(" -|")
    return text[:600]


def extract(block: str, format_family: str, msg_id: str, idx: int,
            source: str = "", sub_source: str = "", nickname: str = "",
            subject: str = "") -> Listing:
    money = extract_money_fields(block)
    city, state, county = extract_location(block)
    model, confident = classify_model(block)
    url_m = re.search(r"https?://[^\s\)>\]]+", block)
    url = url_m.group(0) if url_m else ""
    # Prefer a real listing URL over an elink wrapper when both appear.
    for candidate in re.findall(r"https?://[^\s\)>\]]+", block):
        if "elink" not in candidate.lower() and "mail.smbdealhunter" not in candidate.lower():
            url = candidate
            break

    domain = source or format_family
    lst = Listing(
        # ext_id keeps format_family prefix for stable upsert identity across
        # remodel of source→domain.
        ext_id=f"{format_family}:{msg_id}:{idx}",
        title=extract_title(block, subject=subject),
        blurb=clean_blurb(block, url),
        source=domain,
        sub_source=sub_source,
        nickname=nickname,
        format_family=format_family,
        source_msg=msg_id,
        url=url,
        city=city, state=state, county=county,
        revenue=money.get("revenue"),
        ebitda=money.get("ebitda"),
        sde=money.get("sde"),
        asking=money.get("asking"),
        business_model_type=model,
        seen_in=[domain],
        refs=[(domain, msg_id, url)],
    )
    if lst.earnings is None: lst.needs_llm.append("earnings")
    if lst.state is None:    lst.needs_llm.append("location")
    if not confident:        lst.needs_llm.append("business_model_type")
    return lst


# =====================================================================
# 5. DEDUPE
# =====================================================================

# Bug found against real SMB Deal Exchange URLs: blanket-stripping the query
# string (right, for BizBuySell's tracking params) collapsed 5 DISTINCT
# listings — .../listing-details?recordId=recfbdJnSjZQCegIG vs ...=rec7kQ...
# — onto the identical bare path, since recordId lives in the query string
# for that platform. That merged 4 real, unique deals into 1 via the
# URL-match dedupe pass. Fix: drop only known tracking params, keep anything
# else (recordId and similar are exactly the kind of param that IS the
# listing identity on some platforms).
_TRACKING_PARAMS = re.compile(
    r"(?:^|[?&])(utm_[a-z]+|ref|referrer|source|fbclid|gclid|mc_(?:cid|eid))=[^&]*", re.I
)

def norm_url(u: str) -> str:
    if not u:
        return ""
    u = u.rstrip("/")
    if "#" in u:
        u = u.split("#", 1)[0]
    if "?" in u:
        base, qs = u.split("?", 1)
        kept = [p for p in qs.split("&")
                if p and not _TRACKING_PARAMS.match("?" + p)]
        u = base + ("?" + "&".join(kept) if kept else "")
    return u.lower()

def title_sim(a: str, b: str) -> float:
    clean = lambda s: re.sub(r"[^a-z ]", "", s.lower())
    return SequenceMatcher(None, clean(a), clean(b)).ratio()

# Bug found running db.py's own enrichment demo: a broker follow-up titled
# "Established HVAC & Plumbing Company" should match the original BizAlert
# listing "Established HVAC & Plumbing Company, Full Service Residential
# and Commercial" — same business, just a shorter headline the second time.
# SequenceMatcher.ratio() is 2*M/(len(a)+len(b)): a clean prefix match still
# scores only ~0.63 here because it divides by the COMBINED length, and a
# shorter truncated title is heavily penalized for being short. That's well
# under the 0.82 threshold, so the fuzzy pass silently missed its own
# documented reason for existing and inserted a duplicate row instead of
# enriching the original. Fix: also treat it as a match when the shorter
# cleaned title is contained in the longer one (guarded by a minimum length
# so generic short titles like "Company" don't trivially match everything).
def titles_match(a: str, b: str, threshold: float = 0.82) -> bool:
    if title_sim(a, b) > threshold:
        return True
    clean = lambda s: re.sub(r"[^a-z ]", "", s.lower()).strip()
    ca, cb = clean(a), clean(b)
    shorter, longer = (ca, cb) if len(ca) <= len(cb) else (cb, ca)
    return len(shorter) >= 12 and shorter in longer

def dedupe(items: List[Listing]) -> Tuple[List[Listing], int]:
    kept: List[Listing] = []
    merged = 0
    for it in items:
        hit = None
        for k in kept:
            # pass 1 — exact URL
            if it.url and norm_url(it.url) == norm_url(k.url):
                hit = k; break
            # pass 2 — economic fingerprint
            if it.earnings and k.earnings and it.state and it.fingerprint() == k.fingerprint():
                hit = k; break
            # pass 3 — fuzzy title, same state
            if it.state and it.state == k.state and titles_match(it.title, k.title):
                hit = k; break
        if hit:
            merged += 1
            it.dupe_of = hit.ext_id
            for s in it.seen_in:
                if s not in hit.seen_in:
                    hit.seen_in.append(s)
            for rf in it.refs:
                if rf not in hit.refs:
                    hit.refs.append(rf)
            # keep the richer record
            # A merge can upgrade an SDE-only record to a real EBITDA one when
            # a second source disclosed it. That is the main reason to merge
            # rather than dedupe-and-drop.
            for f in ("revenue", "ebitda", "sde", "asking", "city", "state", "county"):
                if getattr(hit, f) is None and getattr(it, f) is not None:
                    setattr(hit, f, getattr(it, f))
            if not hit.url and it.url:
                hit.url = it.url
        else:
            kept.append(it)
    return kept, merged


# =====================================================================
# 6. HEALTH — the thing that catches silent failure
# =====================================================================

BASELINE = {"bizbuysell": 12, "axial": 4, "newsletter": 8}

def health(per_source: Dict[str, int]) -> List[str]:
    """A newsletter redesign turns a working parser into a silent zero.
    Yield-vs-baseline is the only way that surfaces before you notice
    the report has quietly gotten shorter."""
    alerts = []
    for src, base in BASELINE.items():
        got = per_source.get(src, 0)
        if got == 0 and base > 0:
            alerts.append(f"CRITICAL {src}: 0 listings (baseline ~{base}) — parser likely broken")
        elif got < base * 0.4:
            alerts.append(f"WARN {src}: {got} listings vs baseline ~{base}")
    for src, got in per_source.items():
        if src not in BASELINE:
            alerts.append(f"INFO new source {src}: {got} listings")
    return alerts


# =====================================================================
# ORCHESTRATOR
# =====================================================================

def _is_junk_title(title: str) -> bool:
    """Drop half-listings and URL crumbs that should never reach the board."""
    t = (title or "").strip()
    if not t or t == "(untitled listing)":
        return True
    if re.match(r"^location\s*:", t, re.I):
        return True
    if re.match(r"^https?://", t, re.I):
        return True
    if re.match(r"^asking price\s*:", t, re.I):
        return True
    # Mid-word BizAlert leftovers ("rations", "usiness") if peel ever fails.
    if len(t) < 20 and t[:1].islower():
        return True
    return False


def ingest(emails: List[RawEmail]):
    raw = []
    per_source, per_sub_source, per_nickname, per_family = {}, {}, {}, {}
    for em in emails:
        family = format_family(em)
        domain, email_addr, nick = attribution(em)
        if family in ("newsletter", "dealstream", "businessexits", "benchmark"):
            blocks = split_newsletter(em.body, sender=em.sender)
        else:
            blocks = SPLITTERS[family](em.body)
        per_family[family] = per_family.get(family, 0) + len(blocks)
        per_source[domain] = per_source.get(domain, 0) + len(blocks)
        per_sub_source[email_addr or "(none)"] = (
            per_sub_source.get(email_addr or "(none)", 0) + len(blocks)
        )
        per_nickname[nick] = per_nickname.get(nick, 0) + len(blocks)
        for i, b in enumerate(blocks):
            listing = extract(
                b, family, em.msg_id, i,
                source=domain, sub_source=email_addr, nickname=nick,
                subject=em.subject,
            )
            if _is_junk_title(listing.title):
                continue
            raw.append(listing)
    kept, merged = dedupe(raw)
    return kept, {
        "raw": len(raw), "kept": len(kept), "merged": merged,
        "per_source": per_source,
        "per_sub_source": per_sub_source,
        "per_nickname": per_nickname,
        "per_family": per_family,
        "alerts": health(per_family),
    }


# =====================================================================
# TESTS — realistic email shapes
# =====================================================================

# Module-level fixture so db.py and future tests can import it.
EMAILS = [
        # Real structure, confirmed against a live BizAlert email (HTML-only,
        # no plaintext part — strip_html() runs first in production). These
        # alerts NEVER carry financials, only asking price and location;
        # earnings arrive later if at all (see the db.py enrichment demo).
        RawEmail("m1", "BizAlert <alerts@bizbuysell.com>",
                 "3 New Business Matches: Central Texas", "2026-07-30", body="""
BizBuySell Businesses Recently Posted for Sale

Tristan, see what's just been listed for sale on BizBuySell!

The following businesses match your search criteria.

Established HVAC & Plumbing Company, Full Service Residential and Commercial

Asking Price:

$620,000

Location:
Georgetown, TX

Commercial Landscaping Company with Recurring Monthly Contracts

Asking Price:

$1,450,000

Location:
Waco, TX

Wholesale Industrial Consumables Distributor, Ships Nationally

Asking Price:

$4,900,000

Location:
Fort Worth, TX

The following franchises match your search criteria.

Dryer Vent Wizard

Capital Required:
$83,700 - $126,400

Location: Available in a location near you

This email is being sent to tristan@tullyinvesting.com because you signed up
to receive notification about new business listings matching your acquisition
criteria. To unsubscribe from this email, click here.
"""),

        RawEmail("m2", "Axial Deal Alerts <alerts@axial.net>",
                 "3 new opportunities match your profile", "2026-07-30", body="""
New opportunities

1. Industrial Filter Media Manufacturer
Tulsa, OK
Manufacturer of filter media and cartridge filters. Multi-year contract
backlog with municipal water treatment plants. Ships nationwide.
Revenue: $8.5M | Adjusted EBITDA: $1.4M
https://network.axial.net/opportunity/filter-media-88213

2. Commercial Water Filtration Systems
Cleveland, OH
Manufactures and services water filtration systems sold to hospitals and
health systems nationally. Recurring filter replacement contracts.
Revenue: $2.1M | EBITDA: $410K
https://network.axial.net/opportunity/water-filt-88301

3. Regional Home Services Platform
Columbus, OH
Leading residential HVAC and plumbing provider. Crews across the metro.
Revenue: $12M | EBITDA: $2.0M
https://network.axial.net/opportunity/home-svcs-88450
"""),

        RawEmail("m3", "SMB Deal Digest <hello@smbdealdigest.co>",
                 "This week in lower middle market", "2026-07-30", body="""
Good morning. Five deals worth your time this week.

Industrial Filter Media Manufacturer -- Oklahoma
A filter media and cartridge manufacturer with municipal water treatment
contracts. Doing $8.5M revenue and about $1.4M of EBITDA. Ships nationwide.
https://network.axial.net/opportunity/filter-media-88213

Backflow Prevention Testing Route -- San Antonio, TX
Route-based backflow prevention testing and water quality compliance work
for municipalities. Revenue: $900,000. SDE: $280,000.

Precision Machining Company -- Phoenix, AZ
Contract manufacturer shipping nationally, long-term agreements with
aerospace primes. Largest customer is 40% of revenue.
Revenue: $9M. EBITDA: $1.6M.

That's all for this week. Forward to a friend.
"""),

        # Both figures published on the same listing — proves the two columns
        # stay independent instead of one overwriting the other.
        RawEmail("m4", "Gulf Coast M&A <deals@gulfcoastma.com>",
                 "Confidential opportunity", "2026-07-30", body="""
Confidential Opportunity — Commercial Plumbing Contractor
New Braunfels, TX

Long-tenured commercial plumbing contractor serving general contractors
across the I-35 corridor. Licensed crews, recurring service agreements.

Revenue: $6,400,000
Adjusted EBITDA: $1,050,000
Seller's Discretionary Earnings: $1,310,000
Asking Price: $4,200,000
"""),
]


if __name__ == "__main__":
    kept, stats = ingest(EMAILS)

    print("=" * 78)
    print(f"INGEST  raw={stats['raw']}  kept={stats['kept']}  merged={stats['merged']}")
    print(f"per-source: {stats['per_source']}")
    for a in stats["alerts"]:
        print(f"  ! {a}")
    print("=" * 78)

    print(f"\n{'EARNINGS':<12}{'EBITDA':>12}{'SDE':>12}{'REVENUE':>12}   BASIS   TITLE")
    print("-" * 78)
    for l in kept:
        eb = f"${l.ebitda:,.0f}" if l.ebitda else "—"
        sd = f"${l.sde:,.0f}" if l.sde else "—"
        rv = f"${l.revenue:,.0f}" if l.revenue else "—"
        print(f"{l.earnings_display():<12}{eb:>12}{sd:>12}{rv:>12}"
              f"   {(l.earnings_basis or '—'):<7} {l.title[:32]}")

    print("\n" + "-" * 78)
    for l in kept:
        loc = ", ".join(x for x in [l.city, l.county, l.state] if x) or "?"
        print(f"\n{l.title[:60]}")
        print(f"   {loc:<28} {l.business_model_type:<19} src={'+'.join(l.seen_in)}")
        print(f"   rev={rv:<14} earnings={l.earnings_display()} ({l.earnings_basis or 'none'})")
        if l.needs_llm:
            print(f"   -> LLM pass needed: {', '.join(l.needs_llm)}")
    print("\n* = SDE (includes owner compensation)")
