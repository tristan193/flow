"""
Enrich BizBuySell deals by opening the listing URL from the email.

Email alerts carry asking + location only. Cash Flow (SDE) / EBITDA / Gross
Revenue live on the listing page when the broker disclosed them. Discovery
stays email-only; this is a second pass that fills money fields from the
exact Profile URL we already stored (deals.url_norm — tracking params stripped).

Primary fetch path: Apify `abotapi/bizbuysell-scraper` with
`/business-opportunity/{slug}/{id}/` URLs (Profile/?q= returns empty; generic
Playwright+residential gets Akamai Access Denied). Slug is derived from the
deal title; listing id is what matters.

Part of daily harvest (not optional): after Gmail ingest, every BizBuySell deal
missing earnings is enriched unless the email headline hits a buy-box exclusion
(restaurant / retail / franchise / etc.).

  set APIFY_TOKEN=...   # Apify → Settings → Integrations → API tokens
  python enrich_bizbuysell.py --db nm_deals.db --backend apify --limit 5 --dry-run
  python enrich_bizbuysell.py --db nm_deals.db --backend apify

Requires Apify Starter (or higher) — Free plan has no residential proxy.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))


def apify_token() -> str:
    """APIFY_TOKEN env, or pipeline/credentials/apify_token.txt (gitignored)."""
    t = (os.environ.get("APIFY_TOKEN") or "").strip()
    if t:
        return t
    path = os.path.join(HERE, "credentials", "apify_token.txt")
    if os.path.isfile(path):
        return open(path, encoding="utf-8").read().strip()
    return ""


# Default: dedicated BizBuySell store actor. Generic Playwright+residential
# gets Akamai Access Denied; this actor accepts /business-opportunity/{slug}/{id}/.
DEFAULT_APIFY_ACTOR = os.environ.get(
    "APIFY_BBS_ACTOR", "abotapi~bizbuysell-scraper"
)

# Runs in Apify's Node Playwright context — wait for financials, return body text.
_PLAYWRIGHT_PAGE_FUNCTION = """
async function pageFunction(context) {
    const { page, request, log } = context;
    try {
        await page.waitForSelector('text=Asking Price', { timeout: 45000 });
    } catch (e) {
        log.warning('Asking Price not found for ' + request.url);
    }
    await page.waitForTimeout(800);
    const text = await page.locator('body').innerText();
    return {
        url: page.url(),
        requestUrl: request.url,
        text,
    };
}
"""

# Labeled financials on the listing page, e.g.
#   Cash Flow (SDE): $46,218
#   EBITDA: Not Disclosed
#   Gross Revenue: $2,930,000
_FIN_LINE = re.compile(
    r"(?im)^\s*(Asking\s+Price|Cash\s+Flow(?:\s*\(SDE\))?|EBITDA|Gross\s+Revenue)\s*:\s*"
    r"(Not\s+Disclosed|\$[\d,]+(?:\.\d+)?)\s*$"
)
# Same labels but value on the next line (common in some BBS layouts / a11y trees).
_FIN_NEXT = re.compile(
    r"(?im)^\s*(Asking\s+Price|Cash\s+Flow(?:\s*\(SDE\))?|EBITDA|Gross\s+Revenue)\s*:?\s*$"
    r"\s*^\s*(Not\s+Disclosed|\$[\d,]+(?:\.\d+)?)\s*$"
)
# Inline without requiring line anchors after heavy whitespace collapse.
_FIN_INLINE = re.compile(
    r"(?i)(Asking\s+Price|Cash\s+Flow(?:\s*\(SDE\))?|EBITDA|Gross\s+Revenue)\s*:?\s*"
    r"(Not\s+Disclosed|\$[\d,]+(?:\.\d+)?)"
)
_CITY_STATE = re.compile(
    r"(?i)(?:in\s+)?([A-Za-z .'-]+),\s*(Texas|California|Florida|New York|"
    r"Arizona|Colorado|Georgia|Illinois|North Carolina|Oklahoma|Louisiana|"
    r"Arkansas|Washington|Oregon|Nevada|Tennessee|Virginia|Maryland|"
    r"Pennsylvania|Ohio|Michigan|Minnesota|Wisconsin|Missouri|Indiana|"
    r"Alabama|Mississippi|South Carolina|Kentucky|Utah|New Mexico|"
    r"Connecticut|Massachusetts|New Jersey|[A-Z]{2})\b"
)
_STATE_ABBR = {
    "texas": "TX", "california": "CA", "florida": "FL", "new york": "NY",
    "arizona": "AZ", "colorado": "CO", "georgia": "GA", "illinois": "IL",
    "north carolina": "NC", "oklahoma": "OK", "louisiana": "LA",
    "arkansas": "AR", "washington": "WA", "oregon": "OR", "nevada": "NV",
    "tennessee": "TN", "virginia": "VA", "maryland": "MD",
    "pennsylvania": "PA", "ohio": "OH", "michigan": "MI", "minnesota": "MN",
    "wisconsin": "WI", "missouri": "MO", "indiana": "IN", "alabama": "AL",
    "mississippi": "MS", "south carolina": "SC", "kentucky": "KY",
    "utah": "UT", "new mexico": "NM", "connecticut": "CT",
    "massachusetts": "MA", "new jersey": "NJ",
}


@dataclass
class Enrichment:
    listing_id: str
    asking: Optional[float] = None
    sde: Optional[float] = None
    ebitda: Optional[float] = None
    revenue: Optional[float] = None
    city: Optional[str] = None
    state: Optional[str] = None
    final_url: str = ""
    ok: bool = False
    error: str = ""


def listing_id_from_url(url: str) -> str:
    if not url:
        return ""
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    if "q" in qs and qs["q"]:
        return qs["q"][0].strip()
    m = re.search(r"/(\d{6,})/?(?:\?|$)", parsed.path)
    return m.group(1) if m else ""


def slugify_title(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (title or "").lower())
    s = re.sub(r"-+", "-", s).strip("-")
    return (s[:90] or "listing")


def canonical_bbs_url(url: str) -> str:
    """Strip email trackers; keep Profile/?q=<id> for storage/display."""
    lid = listing_id_from_url(url)
    if lid:
        return f"https://www.bizbuysell.com/listings/Profile/?q={lid}"
    return url


def bbs_actor_url(url: str, title: str = "") -> str:
    """URL shape the abotapi actor accepts (slug path, not Profile/?q=).

    Confirmed: Profile/?q= → empty dataset; /business-opportunity/{slug}/{id}/
    returns cashFlow / askingPrice. Slug is SEO; listing id is what matters.
    """
    lid = listing_id_from_url(url)
    if not lid:
        return url
    path = (urlparse(url).path or "").lower()
    if "/business-opportunity/" in path:
        return f"https://www.bizbuysell.com{urlparse(url).path.rstrip('/')}/"
    return (
        f"https://www.bizbuysell.com/business-opportunity/"
        f"{slugify_title(title)}/{lid}/"
    )


def parse_money(raw: Any) -> Optional[float]:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw) if raw == raw else None  # NaN guard
    raw = str(raw).strip()
    if not raw or re.match(r"(?i)not\s+disclosed|n/?a|undisclosed|null", raw):
        return None
    m = re.search(r"\$?\s*([\d,]+(?:\.\d+)?)", raw)
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


def parse_listing_text(text: str, final_url: str = "") -> Enrichment:
    """Parse the visible financials block from a listing page's innerText."""
    out = Enrichment(listing_id=listing_id_from_url(final_url), final_url=final_url)
    if not text or len(text) < 80:
        out.error = "empty page"
        return out
    if re.search(r"(?i)access\s+denied|akamai|attention\s+required|cf-browser|captcha", text):
        out.error = "blocked/challenge page"
        return out
    if re.search(r"(?i)listing (?:is )?(?:no longer|not) available|page not found", text):
        out.error = "listing gone"
        return out

    # Normalize the financials block so labels sit on their own lines.
    block = text
    block = re.sub(
        r"(?i)(Asking\s+Price|Cash\s+Flow(?:\s*\(SDE\))?|EBITDA|Gross\s+Revenue)\s*:",
        r"\n\1:",
        block,
    )
    block = re.sub(r"\r\n?", "\n", block)

    found: dict[str, Optional[float]] = {}

    def _apply(label: str, value: str) -> None:
        amount = parse_money(value)
        lab = label.lower()
        if lab.startswith("asking"):
            found["asking"] = amount
        elif "cash" in lab:
            found["sde"] = amount
        elif "ebitda" in lab:
            found["ebitda"] = amount
        elif "revenue" in lab:
            found["revenue"] = amount

    for m in _FIN_LINE.finditer(block):
        _apply(m.group(1), m.group(2))
    if not found:
        for m in _FIN_NEXT.finditer(block):
            _apply(m.group(1), m.group(2))
    if not found:
        for m in _FIN_INLINE.finditer(block):
            _apply(m.group(1), m.group(2))

    if not found:
        # Help debug Apify page text without dumping secrets.
        snippet = re.sub(r"\s+", " ", text)[:240]
        out.error = f"no financials block | head={snippet!r}"
        return out

    out.asking = found.get("asking")
    out.sde = found.get("sde")
    out.ebitda = found.get("ebitda")
    out.revenue = found.get("revenue")

    # Title pattern: "... in Burnet, Texas - BizBuySell"
    title_m = re.search(
        r"(?im)^(.{10,160}?)\s+in\s+([A-Za-z .'-]+),\s*([A-Za-z ]+)\s*-\s*BizBuySell\s*$",
        text,
    )
    if title_m:
        city, region = title_m.group(2).strip(), title_m.group(3).strip()
        out.city = city
        out.state = _STATE_ABBR.get(region.lower(), region.upper() if len(region) == 2 else None)
    else:
        loc = _CITY_STATE.search(text[:800])
        if loc:
            out.city = loc.group(1).strip()
            region = loc.group(2).strip()
            out.state = _STATE_ABBR.get(region.lower(), region.upper() if len(region) == 2 else None)

    out.ok = True
    return out


def enrichment_from_apify_item(item: dict, fallback_url: str = "") -> Enrichment:
    """Map abotapi/bizbuysell-scraper (and similar) JSON → Enrichment."""
    url = (
        item.get("url")
        or item.get("listingUrl")
        or item.get("sourceUrl")
        or fallback_url
        or ""
    )
    lid = str(item.get("id") or "").strip() or listing_id_from_url(url) or listing_id_from_url(fallback_url)
    raw = item.get("detailsRaw") if isinstance(item.get("detailsRaw"), dict) else {}

    def pick(*keys: str) -> Any:
        for k in keys:
            if item.get(k) is not None:
                return item.get(k)
            if raw.get(k) is not None:
                return raw.get(k)
        return None

    e = Enrichment(
        listing_id=lid,
        asking=parse_money(pick("askingPrice", "asking_price", "asking")),
        sde=parse_money(pick("cashFlow", "cash_flow", "sde", "cashFlowSde")),
        ebitda=parse_money(pick("ebitda", "EBITDA")),
        revenue=parse_money(pick("grossRevenue", "gross_revenue", "revenue")),
        city=(item.get("city") or None),
        state=(item.get("state") or None),
        final_url=url or fallback_url,
        ok=True,
    )
    if e.state and len(str(e.state)) > 2:
        e.state = _STATE_ABBR.get(str(e.state).lower(), None) or (
            e.state[:2].upper() if len(str(e.state)) == 2 else e.state
        )
    elif e.state:
        e.state = str(e.state).upper()
    # A result with no money fields still counts as ok — page may be Not Disclosed.
    return e


def headline_buybox_reject(title: str, blurb: str = "") -> Optional[str]:
    """If title/blurb is an excluded category (and not strategic), skip Apify.

    Email is thin — we still need the headline to avoid paying for restaurants,
    retail, franchise resales, etc. that the buy box hard-rejects.
    """
    try:
        import score as sc
    except Exception as exc:
        print(f"buybox check unavailable ({exc}); enriching without skip")
        return None
    text = f"{title or ''} {blurb or ''}".lower()
    excl = sc.check_excluded(text)
    strat = sc.check_strategic(text)
    if excl and not strat:
        cats = sorted({c for c, _ in excl})
        return f"Excluded category: {', '.join(cats)}"
    return None


def candidates(
    con: sqlite3.Connection,
    limit: int = 0,
    newest: bool = False,
    *,
    skip_buybox: bool = True,
) -> tuple[list[sqlite3.Row], list[tuple[sqlite3.Row, str]]]:
    """BizBuySell rows with a URL and no earnings yet.

    Returns (to_enrich, skipped_buybox) where skipped entries are (row, reason).
    """
    order = "last_seen DESC, id DESC" if newest else "id"
    sql = f"""
      SELECT id, ext_id, title, blurb, url_norm, city, state,
             revenue, ebitda, sde, asking, needs_llm, source, nickname
      FROM deals
      WHERE url_norm LIKE '%bizbuysell.com%'
        AND ebitda IS NULL AND sde IS NULL
      ORDER BY {order}
    """
    rows = list(con.execute(sql))
    keep: list[sqlite3.Row] = []
    skipped: list[tuple[sqlite3.Row, str]] = []
    for row in rows:
        if skip_buybox:
            reason = headline_buybox_reject(row["title"] or "", row["blurb"] or "")
            if reason:
                skipped.append((row, reason))
                continue
        keep.append(row)
        if limit > 0 and len(keep) >= limit:
            break
    return keep, skipped


def mark_buybox_skip(
    con: sqlite3.Connection, deal_id: int, reason: str, dry_run: bool
) -> None:
    """Record headline buy-box rejects so we don't retry Apify forever."""
    if dry_run:
        return
    cols = {r[1] for r in con.execute("PRAGMA table_info(deals)")}
    if "rejected" in cols and "reject_reason" in cols:
        con.execute(
            "UPDATE deals SET rejected=1, reject_reason=?, bucket=COALESCE(NULLIF(bucket,''), 'D_suppress') "
            "WHERE id=? AND (rejected IS NULL OR rejected=0)",
            (reason, deal_id),
        )
    else:
        # Older DBs without score columns — nothing to stamp.
        pass


def apply_enrichment(con: sqlite3.Connection, deal_id: int, e: Enrichment, dry_run: bool) -> dict:
    """Write page financials onto the deal; clear needs_llm earnings when filled."""
    row = con.execute("SELECT * FROM deals WHERE id=?", (deal_id,)).fetchone()
    if not row:
        return {"updated": False}

    updates: dict = {}
    for field, val in (
        ("sde", e.sde),
        ("ebitda", e.ebitda),
        ("revenue", e.revenue),
        ("asking", e.asking),
    ):
        if val is not None and (row[field] is None or field == "asking"):
            # Asking from email is usually present; prefer page when both exist
            # only if email was empty. Earnings always fill when null.
            if field == "asking" and row[field] is not None:
                continue
            updates[field] = val

    if e.city and not row["city"]:
        updates["city"] = e.city
    if e.state and not row["state"]:
        updates["state"] = e.state

    needs = json.loads(row["needs_llm"] or "[]")
    if (updates.get("sde") is not None or updates.get("ebitda") is not None
            or e.sde is not None or e.ebitda is not None
            or (e.ok and e.sde is None and e.ebitda is None)):
        # Earnings were checked on the page — drop the earnings flag either way
        # when the page loaded cleanly (disclosed or explicitly Not Disclosed).
        if e.ok and "earnings" in needs:
            needs = [n for n in needs if n != "earnings"]
            updates["needs_llm"] = json.dumps(needs)

    if not updates:
        return {"updated": False, "reason": "nothing new"}

    if dry_run:
        return {"updated": True, "dry_run": True, "updates": updates}

    sets = ", ".join(f"{k}=?" for k in updates)
    con.execute(f"UPDATE deals SET {sets} WHERE id=?", [*updates.values(), deal_id])
    return {"updated": True, "updates": updates}


def _apify_request(
    method: str,
    path: str,
    token: str,
    body: Optional[dict] = None,
    timeout: int = 60,
) -> Any:
    url = f"https://api.apify.com/v2{path}"
    sep = "&" if "?" in url else "?"
    url = f"{url}{sep}token={urllib.parse.quote(token)}"
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"Apify HTTP {exc.code}: {detail}") from exc


def _apify_run_input(actor_id: str, fetch_urls: list[str]) -> dict:
    """Build actor input. Playwright scraper is the reliable path for Profile/?q=."""
    proxy = {
        "useApifyProxy": True,
        "apifyProxyGroups": ["RESIDENTIAL"],
        "apifyProxyCountry": "US",
    }
    if "playwright-scraper" in actor_id or "puppeteer-scraper" in actor_id:
        return {
            "startUrls": [{"url": u} for u in fetch_urls],
            "pageFunction": _PLAYWRIGHT_PAGE_FUNCTION,
            "proxyConfiguration": proxy,
            "launcher": "firefox",
            "headless": True,
            "maxRequestsPerCrawl": len(fetch_urls),
            "maxConcurrency": 2,
            "navigationTimeoutSecs": 60,
            "handlePageTimeoutSecs": 90,
        }
    # Store BizBuySell actors (often expect /business-opportunity/.../id/)
    return {
        "mode": "url",
        "urls": fetch_urls,
        "startUrls": fetch_urls,
        "fetchDetails": True,
        "maxListings": len(fetch_urls),
        "maxPages": 1,
        "proxy": proxy,
        "proxyConfiguration": proxy,
    }


def load_apify_dataset_items(token: str, run_id: str) -> list[dict]:
    polled = _apify_request("GET", f"/actor-runs/{run_id}", token, timeout=60)
    pdata = polled.get("data") or polled
    dataset_id = pdata.get("defaultDatasetId")
    if not dataset_id:
        raise RuntimeError(f"run {run_id} has no dataset")
    items_resp = _apify_request(
        "GET",
        f"/datasets/{dataset_id}/items?format=json&clean=1",
        token,
        timeout=120,
    )
    items = items_resp if isinstance(items_resp, list) else (items_resp.get("data") or [])
    return [it for it in items if isinstance(it, dict)]


def enrichments_from_apify_items(items: list[dict]) -> dict[str, Enrichment]:
    """Map dataset items → Enrichment keyed by listing id (and canonical url)."""
    by_id: dict[str, Enrichment] = {}
    for item in items:
        text = item.get("text") or item.get("body") or ""
        if text:
            final = item.get("url") or item.get("requestUrl") or ""
            e = parse_listing_text(text, final)
            lid = (
                e.listing_id
                or listing_id_from_url(final)
                or listing_id_from_url(item.get("requestUrl") or "")
            )
            if lid:
                e.listing_id = lid
                by_id[lid] = e
            continue
        e = enrichment_from_apify_item(item)
        if e.listing_id:
            by_id[e.listing_id] = e
    return by_id


def fetch_with_apify(
    urls: list[str],
    token: str,
    actor_id: str = DEFAULT_APIFY_ACTOR,
    wait_secs: int = 900,
    titles: Optional[dict[str, str]] = None,
) -> dict[str, Enrichment]:
    """Fetch listing pages via Apify; return enrichment keyed by input url_norm."""
    if not token:
        raise RuntimeError("APIFY_TOKEN is empty")
    if not urls:
        return {}

    titles = titles or {}
    # Dedicated actor needs /business-opportunity/{slug}/{id}/; Profile/?q= returns empty.
    if "bizbuysell" in actor_id.lower() and "playwright" not in actor_id:
        fetch_urls = [bbs_actor_url(u, titles.get(u, "")) for u in urls]
    else:
        fetch_urls = [canonical_bbs_url(u) for u in urls]
    run_input = _apify_run_input(actor_id, fetch_urls)

    print(f"apify actor={actor_id} urls={len(fetch_urls)}")
    for fu in fetch_urls:
        print(f"  fetch {fu}")
    started = _apify_request(
        "POST",
        f"/acts/{actor_id}/runs",
        token,
        body=run_input,
        timeout=120,
    )
    data = started.get("data") or started
    run_id = data.get("id")
    if not run_id:
        raise RuntimeError(f"Apify start failed: {started}")

    deadline = time.time() + wait_secs
    status = data.get("status") or "READY"
    pdata = data
    while status in ("READY", "RUNNING", "ABORTING"):
        if time.time() > deadline:
            raise RuntimeError(f"Apify run {run_id} timed out after {wait_secs}s (status={status})")
        time.sleep(5)
        polled = _apify_request("GET", f"/actor-runs/{run_id}", token, timeout=60)
        pdata = polled.get("data") or polled
        status = pdata.get("status") or status
        print(f"  apify run={run_id} status={status}")

    if status != "SUCCEEDED":
        raise RuntimeError(f"Apify run {run_id} ended with status={status}")

    dataset_id = pdata.get("defaultDatasetId") or data.get("defaultDatasetId")
    if not dataset_id:
        raise RuntimeError(f"Apify run {run_id} has no dataset")

    items_resp = _apify_request(
        "GET",
        f"/datasets/{dataset_id}/items?format=json&clean=1",
        token,
        timeout=120,
    )
    items = items_resp if isinstance(items_resp, list) else (items_resp.get("data") or [])
    print(f"  apify dataset items={len(items)}")

    by_id = enrichments_from_apify_items(items)

    results: dict[str, Enrichment] = {}
    for url in urls:
        lid = listing_id_from_url(url)
        e = by_id.get(lid)
        if e and e.ok:
            results[url] = e
            print(
                f"  ok id={lid} sde={e.sde} ebitda={e.ebitda} rev={e.revenue} "
                f"ask={e.asking} {e.city},{e.state}"
            )
        elif e:
            results[url] = e
            print(f"  fail id={lid}: {e.error}")
        else:
            results[url] = Enrichment(
                listing_id=lid,
                error="not in Apify dataset (blocked, gone, or actor miss)",
            )
            print(f"  miss id={lid} url={bbs_actor_url(url, titles.get(url, ''))}")
    return results


def fetch_with_playwright(urls: list[str], pause_s: float = 1.2) -> dict[str, Enrichment]:
    """Open listing URLs in Firefox; return enrichment keyed by original URL.

    Chromium gets a hard Akamai Access Denied from datacenter/scripted IPs.
    Firefox clears the challenge and reaches the financials block (confirmed
    against live Profile URLs). Use the same browser in CI.
    """
    from playwright.sync_api import sync_playwright

    results: dict[str, Enrichment] = {}
    with sync_playwright() as p:
        browser = p.firefox.launch(headless=True)
        context = browser.new_context(
            locale="en-US",
            viewport={"width": 1280, "height": 900},
        )
        page = context.new_page()

        for i, url in enumerate(urls):
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=45000)
                # Bot challenge, then the financials block.
                page.wait_for_selector("text=Asking Price", timeout=45000)
                page.wait_for_timeout(600)
                text = page.inner_text("body")
                final = page.url
                e = parse_listing_text(text, final)
                if not e.listing_id:
                    e.listing_id = listing_id_from_url(url)
                results[url] = e
                status = "ok" if e.ok else f"fail:{e.error}"
                print(
                    f"  [{i+1}/{len(urls)}] {status} "
                    f"sde={e.sde} ebitda={e.ebitda} rev={e.revenue} "
                    f"ask={e.asking} {e.city},{e.state}"
                )
            except Exception as exc:
                results[url] = Enrichment(
                    listing_id=listing_id_from_url(url),
                    error=f"{type(exc).__name__}: {exc}",
                )
                print(f"  [{i+1}/{len(urls)}] ERROR {results[url].error}")
            if pause_s and i + 1 < len(urls):
                time.sleep(pause_s)

        browser.close()
    return results


def main() -> None:
    ap = argparse.ArgumentParser(description="Enrich BizBuySell deals from listing pages")
    ap.add_argument("--db", default=os.environ.get("NM_LOCAL_DB", os.path.join(HERE, "nm_deals.db")))
    ap.add_argument("--limit", type=int, default=0, help="Max listings to fetch (0 = all)")
    ap.add_argument(
        "--newest",
        action="store_true",
        help="Prefer recently seen deals (last_seen DESC) instead of oldest id",
    )
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--pause", type=float, default=1.2, help="Seconds between Playwright loads")
    ap.add_argument(
        "--backend",
        choices=("apify", "playwright", "auto"),
        default=os.environ.get("BBS_ENRICH_BACKEND", "auto"),
        help="apify (default when APIFY_TOKEN set), playwright, or auto",
    )
    ap.add_argument(
        "--actor",
        default=DEFAULT_APIFY_ACTOR,
        help="Apify actor id (default abotapi~bizbuysell-scraper)",
    )
    ap.add_argument(
        "--from-run",
        default="",
        help="Re-parse an existing Apify run dataset (no new scrape / no extra $)",
    )
    ap.add_argument(
        "--no-buybox-skip",
        action="store_true",
        help="Enrich even when headline matches buy-box exclusions",
    )
    ap.add_argument(
        "--parse-file",
        default="",
        help="Parse a saved page text/HTML file instead of fetching (dev)",
    )
    args = ap.parse_args()

    if args.parse_file:
        text = open(args.parse_file, encoding="utf-8", errors="replace").read()
        # If HTML, strip tags lightly for the labeled-line regex.
        if "<" in text[:200]:
            text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.I)
            text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
            text = re.sub(r"<[^>]+>", "\n", text)
            text = re.sub(r"[ \t]+", " ", text)
        e = parse_listing_text(text)
        print(json.dumps(e.__dict__, indent=2))
        return

    if not os.path.exists(args.db):
        print(f"FATAL: db not found: {args.db}", file=sys.stderr)
        sys.exit(1)

    token = apify_token()
    backend = args.backend
    if backend == "auto":
        backend = "apify" if token else "playwright"

    if (backend == "apify" or args.from_run) and not token:
        print(
            "FATAL: apify path requires APIFY_TOKEN or pipeline/credentials/apify_token.txt",
            file=sys.stderr,
        )
        sys.exit(1)

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row
    rows, skipped = candidates(
        con,
        args.limit,
        newest=args.newest,
        skip_buybox=not args.no_buybox_skip,
    )
    print(
        f"candidates={len(rows)} buybox_skip={len(skipped)} db={args.db} "
        f"backend={backend} newest={args.newest} dry_run={args.dry_run}"
    )
    for row, reason in skipped:
        print(f"buybox-skip id={row['id']}: {reason} | {(row['title'] or '')[:50]}")
        mark_buybox_skip(con, row["id"], reason, args.dry_run)

    if not rows and not args.from_run:
        if not args.dry_run:
            con.commit()
        con.close()
        print("done {'ok': 0, 'fail': 0, 'updated': 0, 'buybox_skip': %d}" % len(skipped))
        return

    if args.from_run:
        items = load_apify_dataset_items(token, args.from_run)
        print(f"reparse run={args.from_run} items={len(items)}")
        by_id = enrichments_from_apify_items(items)
        fetched = {}
        for row in rows:
            lid = listing_id_from_url(row["url_norm"] or "")
            fetched[row["url_norm"]] = by_id.get(lid) or Enrichment(
                listing_id=lid, error="not in Apify dataset"
            )
            e = fetched[row["url_norm"]]
            if e.ok:
                print(
                    f"  ok id={lid} sde={e.sde} ebitda={e.ebitda} rev={e.revenue} "
                    f"ask={e.asking}"
                )
            else:
                print(f"  fail id={lid}: {e.error}")
    else:
        urls = [r["url_norm"] for r in rows if r["url_norm"]]
        titles = {r["url_norm"]: (r["title"] or "") for r in rows if r["url_norm"]}
        if backend == "apify":
            fetched = fetch_with_apify(
                urls, token=token, actor_id=args.actor, titles=titles
            )
        else:
            fetched = fetch_with_playwright(urls, pause_s=args.pause)

    stats = {"ok": 0, "fail": 0, "updated": 0, "with_earnings": 0, "buybox_skip": len(skipped)}
    for row in rows:
        e = fetched.get(row["url_norm"]) or Enrichment(
            listing_id="", error="not fetched"
        )
        if not e.ok:
            stats["fail"] += 1
            print(f"skip id={row['id']}: {e.error or 'not ok'} | {row['title'][:50]}")
            continue
        stats["ok"] += 1
        if e.sde is not None or e.ebitda is not None:
            stats["with_earnings"] += 1
        result = apply_enrichment(con, row["id"], e, args.dry_run)
        if result.get("updated"):
            stats["updated"] += 1
            print(
                f"update id={row['id']} {result.get('updates')} | {row['title'][:50]}"
            )

    if not args.dry_run:
        con.commit()
    con.close()
    print(f"done {stats}")


if __name__ == "__main__":
    main()
