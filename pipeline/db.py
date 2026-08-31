"""
Nails & Mercy — DEAL DATABASE v1.0

SQLite. One file (deals.db), no infrastructure, ports to Postgres unchanged.

The table is the durable record. Ingestion runs are idempotent: re-running
the same morning does not duplicate rows, and a deal that reappears from a
second source merges into the existing record rather than creating a twin.

EARNINGS MODEL (per Tristan):
    ebitda REAL NULL   -- only when the source said EBITDA
    sde    REAL NULL   -- SDE, DE, "Cash Flow", owner benefit
Never collapsed. A listing publishing both populates both. Reports read
through v_deals.earnings / earnings_basis, which prefer EBITDA and annotate
SDE with an asterisk.
"""

import sqlite3, json, re, os
from datetime import datetime, timezone
from typing import Optional, List
from difflib import SequenceMatcher

import identity as ident

SCHEMA = """
-- NOTE: WAL is faster but unsupported on network/mounted filesystems.
-- Enable it explicitly (see connect()) only on local disk.
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS deals (
  id              INTEGER PRIMARY KEY,
  ext_id          TEXT UNIQUE NOT NULL,
  deal_number     TEXT UNIQUE,
  source_deal_id  TEXT,
  source_ids      TEXT DEFAULT '[]',
  alias_names     TEXT DEFAULT '[]',
  gmail_thread_ids TEXT DEFAULT '[]',
  broker_firm     TEXT,
  fingerprint     TEXT,
  url_norm        TEXT,

  title           TEXT NOT NULL,
  blurb           TEXT,
  -- Attribution triad:
  --   source     = sender domain        (bizbuysell.com)
  --   sub_source = sender email         (bizalert@bizbuysell.com)
  --   nickname   = human-facing label   (BizBuySell)
  source          TEXT,
  sub_source      TEXT,
  nickname        TEXT,

  city            TEXT,
  state           TEXT,
  county          TEXT,

  revenue         REAL,
  ebitda          REAL,      -- ONLY when labeled EBITDA
  sde             REAL,      -- SDE / DE / "Cash Flow" / owner benefit
  asking          REAL,

  business_model_type TEXT DEFAULT '',
  needs_llm       TEXT DEFAULT '[]',

  score           INTEGER,
  bucket          TEXT,
  rejected        INTEGER DEFAULT 0,
  reject_reason   TEXT,
  score_trace     TEXT DEFAULT '[]',

  first_seen      TEXT NOT NULL,
  last_seen       TEXT NOT NULL,
  times_seen      INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS ix_deals_fp     ON deals(fingerprint);
CREATE INDEX IF NOT EXISTS ix_deals_url    ON deals(url_norm);
CREATE INDEX IF NOT EXISTS ix_deals_state  ON deals(state);
CREATE INDEX IF NOT EXISTS ix_deals_bucket ON deals(bucket);
CREATE INDEX IF NOT EXISTS ix_deals_sid    ON deals(source_deal_id);
CREATE TABLE IF NOT EXISTS deal_counters (
  key    TEXT PRIMARY KEY,
  next_n INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO deal_counters (key, next_n) VALUES ('tly', 1);

-- Every provider domain that mentioned a given deal. Seeing the same deal
-- across five newsletters is signal: it has been shopped hard and may be stale.
-- `source` here is the sender domain (same meaning as deals.source).
CREATE TABLE IF NOT EXISTS deal_sources (
  deal_id    INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  source     TEXT NOT NULL,
  msg_id     TEXT NOT NULL,
  url        TEXT,
  seen_at    TEXT NOT NULL,
  PRIMARY KEY (deal_id, source, msg_id)
);

-- Per-member triage. Independent verdicts; disagreement is preserved,
-- not averaged. reason is what trains the preference filter later.
CREATE TABLE IF NOT EXISTS verdicts (
  deal_id    INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  member     TEXT NOT NULL,
  action     TEXT NOT NULL CHECK(action IN ('short','pass','discuss')),
  reason     TEXT,
  note       TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (deal_id, member)
);

-- Per-run health log. Yield-vs-baseline is how a silently broken parser
-- gets caught before the report just quietly gets shorter.
CREATE TABLE IF NOT EXISTS ingest_runs (
  id          INTEGER PRIMARY KEY,
  run_at      TEXT NOT NULL,
  raw         INTEGER, kept INTEGER, merged INTEGER,
  new_deals   INTEGER,
  per_source  TEXT,
  alerts      TEXT
);

CREATE VIEW IF NOT EXISTS v_deals AS
SELECT d.*,
       COALESCE(d.ebitda, d.sde)                     AS earnings,
       CASE WHEN d.ebitda IS NOT NULL THEN 'EBITDA'
            WHEN d.sde    IS NOT NULL THEN 'SDE'
            ELSE NULL END                            AS earnings_basis,
       CASE WHEN d.ebitda IS NULL AND d.sde IS NOT NULL THEN 1 ELSE 0 END
                                                     AS earnings_is_sde,
       CASE WHEN d.revenue > 0
            THEN ROUND(COALESCE(d.ebitda, d.sde) / d.revenue, 4)
            END                                      AS margin,
       (SELECT GROUP_CONCAT(DISTINCT s.source)
          FROM deal_sources s WHERE s.deal_id = d.id) AS sources
FROM deals d;
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

# Was a blanket "[?#].*$" strip — correct for BizBuySell's tracking params,
# but WRONG for platforms where the query string IS the listing identity
# (SMB Deal Exchange's ?recordId=..., and confirmed here against real SMB
# Deal Hunter mail: all 5 items in one digest use
# /item-detail?recordId=XXXX, and the blanket strip collapsed all 5 distinct
# real listings onto the identical bare path — the URL-match dedupe pass
# then merged 4 real deals into 1 row (times_seen=5 on a single Hawaii
# record that silently absorbed the Massage/Transport/Supply/Distributor
# listings). ingest.py fixed this same bug earlier; db.py's separate
# implementation had drifted out of sync. Keep both selective.
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


def connect(path: str = "deals.db", wal: bool = False) -> sqlite3.Connection:
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    if wal:
        try: con.execute("PRAGMA journal_mode=WAL")
        except sqlite3.OperationalError: pass
    con.executescript(SCHEMA)
    _ensure_attribution_columns(con)
    _backfill_deal_numbers(con)
    return con


def _ensure_attribution_columns(con: sqlite3.Connection) -> None:
    """Add source/nickname on DBs created before the attribution triad."""
    cols = {r[1] for r in con.execute("PRAGMA table_info(deals)")}
    extras = {
        "source": "TEXT",
        "nickname": "TEXT",
        "deal_number": "TEXT",
        "source_deal_id": "TEXT",
        "source_ids": "TEXT DEFAULT '[]'",
        "alias_names": "TEXT DEFAULT '[]'",
        "gmail_thread_ids": "TEXT DEFAULT '[]'",
        "broker_firm": "TEXT",
    }
    for name, spec in extras.items():
        if name not in cols:
            con.execute(f"ALTER TABLE deals ADD COLUMN {name} {spec}")
    con.execute(
        "INSERT OR IGNORE INTO deal_counters (key, next_n) VALUES ('tly', 1)"
    )


def _next_deal_number(con: sqlite3.Connection) -> str:
    row = con.execute(
        "UPDATE deal_counters SET next_n = next_n + 1 WHERE key = 'tly' RETURNING next_n - 1"
    ).fetchone()
    n = int(row[0]) if row else 1
    return ident.format_deal_number(n if n > 0 else 1)


def _json_list(value) -> list:
    if isinstance(value, list):
        return value
    if not value:
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except (TypeError, json.JSONDecodeError):
        return []


def _backfill_deal_numbers(con: sqlite3.Connection) -> None:
    missing = con.execute(
        "SELECT id FROM deals WHERE deal_number IS NULL OR deal_number = '' ORDER BY id"
    ).fetchall()
    for row in missing:
        con.execute(
            "UPDATE deals SET deal_number = ? WHERE id = ?",
            (_next_deal_number(con), row["id"]),
        )


# ------------------------------------------------------------------
# UPSERT — the persistent form of dedupe
# ------------------------------------------------------------------
BACKFILL = (
    "revenue", "ebitda", "sde", "asking", "city", "state", "county",
    "source", "sub_source", "nickname",
)

# Everything the extractor owns. When the SAME email is ingested again the
# current parser's output supersedes the stored row — otherwise a parser fix
# can never correct a value the old code got wrong, and the only way to repair
# a deal is to delete it. Cross-source merges keep the BACKFILL rule below.
REPARSE = BACKFILL + ("title", "blurb", "business_model_type", "needs_llm")

# A blank re-parse usually means the extractor lost ground, so it is ignored —
# except for the money fields, where "no figure" is a real answer a parser is
# entitled to give (newbizopps mail carries marketing prose, not earnings).
CLEARABLE = ("revenue", "ebitda", "sde", "asking")

def _title_sim(a: str, b: str) -> float:
    clean = lambda s: re.sub(r"[^a-z ]", "", (s or "").lower())
    return SequenceMatcher(None, clean(a), clean(b)).ratio()

# Kept in sync with ingest.py's titles_match() — same bug, same fix. Found
# running this file's own demo: a broker follow-up titled "Established
# HVAC & Plumbing Company" only scores 0.63 against the original "...,
# Full Service Residential and Commercial" listing (SequenceMatcher divides
# by combined length, so a truncated-but-otherwise-identical title is
# penalized for being short), missing the 0.82 threshold and silently
# inserting a duplicate row instead of enriching the original — which is
# the exact scenario this fuzzy pass was built for.
def _titles_match(a: str, b: str, threshold: float = 0.82) -> bool:
    if _title_sim(a, b) > threshold:
        return True
    clean = lambda s: re.sub(r"[^a-z ]", "", (s or "").lower()).strip()
    ca, cb = clean(a), clean(b)
    shorter, longer = (ca, cb) if len(ca) <= len(cb) else (cb, ca)
    return len(shorter) >= 12 and shorter in longer

def upsert(con: sqlite3.Connection, l) -> tuple:
    """Returns (deal_id, 'new'|'merged'|'repeat').

    Match order mirrors the in-memory deduper: exact URL, economic
    fingerprint, then fuzzy title+state. Cross-RUN matching is why this
    lives in SQL — a deal from Axial on Monday and a newsletter on Thursday
    are the same deal, and only the database remembers Monday.

    The fuzzy pass matters more here than in-memory: a BizAlert record is
    created with NO earnings at all (confirmed — real alerts never carry
    financials), so its fingerprint is computed from state alone. A later
    broker email disclosing EBITDA computes a DIFFERENT fingerprint (now
    including an earnings band) and would never match on fingerprint or URL
    (BizBuySell's own alert HTML doesn't reliably survive to a stable link
    either). Without title-similarity as a fallback, every earnings
    disclosure creates a duplicate row instead of enriching the original."""
    ts = now()
    un = norm_url(l.url)
    fp = l.fingerprint()
    incoming_ids = getattr(l, "source_ids", None) or []
    incoming_sid = getattr(l, "source_deal_id", "") or ""
    if not incoming_sid and incoming_ids:
        incoming_sid = ident.pick_canonical_source_id(incoming_ids) or ""

    row = con.execute("SELECT id FROM deals WHERE ext_id=?", (l.ext_id,)).fetchone()
    same_email = row is not None
    mode = "repeat"

    if not row:
        cands = []
        for r in con.execute(
            "SELECT id, deal_number, source_deal_id, source_ids, fingerprint, "
            "title, alias_names, broker_firm, city, state FROM deals"
        ):
            cands.append({
                "id": r["id"],
                "deal_number": r["deal_number"] if "deal_number" in r.keys() else None,
                "source_deal_id": r["source_deal_id"] if "source_deal_id" in r.keys() else None,
                "source_ids": _json_list(r["source_ids"] if "source_ids" in r.keys() else None),
                "fingerprint": r["fingerprint"],
                "title": r["title"],
                "alias_names": _json_list(r["alias_names"] if "alias_names" in r.keys() else None),
                "broker_firm": r["broker_firm"] if "broker_firm" in r.keys() else None,
                "city": r["city"],
                "state": r["state"],
            })
        hit = ident.find_identity_match(
            {
                "title": l.title,
                "broker_firm": getattr(l, "broker_firm", None),
                "city": l.city,
                "state": l.state,
                "ebitda": l.ebitda,
                "sde": l.sde,
                "url": l.url,
                "source": l.source,
                "nickname": getattr(l, "nickname", None),
                "source_ids": incoming_ids,
                "source_deal_id": incoming_sid,
                "alias_names": getattr(l, "alias_names", None),
                "gmail_thread_ids": getattr(l, "gmail_thread_ids", None),
            },
            cands,
        )
        if hit:
            row = {"id": hit[0]["id"]}
            mode = "merged"

    if not row and un:
        row = con.execute("SELECT id FROM deals WHERE url_norm=? AND url_norm<>''", (un,)).fetchone()
        if row: mode = "merged"

    if row:
        did = row["id"]
        cur = con.execute("SELECT * FROM deals WHERE id=?", (did,)).fetchone()
        updates: dict = {}

        if same_email:
            # Clearing a field back to NULL is only safe when this email is the
            # deal's only source; on a merged row another email may have been
            # the one that supplied it.
            sole_source = con.execute(
                "SELECT COUNT(DISTINCT msg_id) AS c FROM deal_sources WHERE deal_id=?",
                (did,),
            ).fetchone()["c"] <= 1
            for f in REPARSE:
                new = json.dumps(l.needs_llm) if f == "needs_llm" else getattr(l, f, None)
                blank = new is None or (isinstance(new, str) and not new.strip())
                if blank and not (sole_source and f in CLEARABLE):
                    continue
                if new != cur[f]:
                    updates[f] = new
            if fp != cur["fingerprint"]:
                updates["fingerprint"] = fp

        # backfill only NULLs — a later source may disclose EBITDA where the
        # first only gave SDE. Never overwrite a value we already trust.
        for f in BACKFILL:
            if f not in updates and cur[f] is None and getattr(l, f) is not None:
                updates[f] = getattr(l, f)
        if not cur["url_norm"] and un:
            updates["url_norm"] = un

        keys = cur.keys()
        if "alias_names" in keys:
            aliases = ident.merge_alias_names(
                _json_list(cur["alias_names"]),
                l.title,
                cur["title"],
                getattr(l, "alias_names", None),
            )
            updates["alias_names"] = json.dumps(aliases)
        if "gmail_thread_ids" in keys:
            updates["gmail_thread_ids"] = json.dumps(
                ident.merge_thread_ids(
                    _json_list(cur["gmail_thread_ids"]),
                    getattr(l, "gmail_thread_ids", None),
                )
            )
        if "source_ids" in keys:
            prior = _json_list(cur["source_ids"])
            merged = list(prior)
            for s in incoming_ids:
                if s.get("canonical") not in {p.get("canonical") for p in merged if isinstance(p, dict)}:
                    merged.append(s)
            updates["source_ids"] = json.dumps(merged)
        if "source_deal_id" in keys and not cur["source_deal_id"] and incoming_sid:
            updates["source_deal_id"] = incoming_sid
        if "broker_firm" in keys and not cur["broker_firm"] and getattr(l, "broker_firm", None):
            updates["broker_firm"] = l.broker_firm
        if fp and (not cur["fingerprint"] or (same_email and fp != cur["fingerprint"])):
            updates["fingerprint"] = fp

        sets = [f"{f}=?" for f in updates] + ["last_seen=?", "times_seen=times_seen+1"]
        vals = list(updates.values()) + [ts, did]
        con.execute(f"UPDATE deals SET {', '.join(sets)} WHERE id=?", vals)
    else:
        mode = "new"
        number = _next_deal_number(con)
        cur = con.execute("""
          INSERT INTO deals (ext_id,deal_number,source_deal_id,source_ids,alias_names,
                             gmail_thread_ids,broker_firm,
                             fingerprint,url_norm,title,blurb,
                             source,sub_source,nickname,
                             city,state,county,
                             revenue,ebitda,sde,asking,business_model_type,needs_llm,
                             first_seen,last_seen)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
          (l.ext_id, number, incoming_sid or None, json.dumps(incoming_ids),
           json.dumps(getattr(l, "alias_names", None) or [l.title]),
           json.dumps(getattr(l, "gmail_thread_ids", None) or []),
           getattr(l, "broker_firm", None) or None,
           fp, un, l.title, l.blurb,
           getattr(l, "source", None) or None,
           getattr(l, "sub_source", None) or None,
           getattr(l, "nickname", None) or None,
           l.city, l.state, l.county,
           l.revenue, l.ebitda, l.sde, l.asking, l.business_model_type,
           json.dumps(l.needs_llm), ts, ts))
        did = cur.lastrowid

    # One row per email that mentioned this deal — including sources folded
    # in by a within-run merge.
    for src, msg, url in (l.refs or [(l.source, l.source_msg, l.url)]):
        con.execute("""INSERT OR IGNORE INTO deal_sources (deal_id,source,msg_id,url,seen_at)
                       VALUES (?,?,?,?,?)""", (did, src, msg, url, ts))
    return did, mode


def log_run(con, stats, new_count):
    con.execute("""INSERT INTO ingest_runs (run_at,raw,kept,merged,new_deals,per_source,alerts)
                   VALUES (?,?,?,?,?,?,?)""",
                (now(), stats["raw"], stats["kept"], stats["merged"], new_count,
                 json.dumps(stats["per_source"]), json.dumps(stats["alerts"])))


def set_verdict(con, deal_id, member, action, reason=None, note=None):
    con.execute("""INSERT INTO verdicts (deal_id,member,action,reason,note,created_at)
                   VALUES (?,?,?,?,?,?)
                   ON CONFLICT(deal_id,member) DO UPDATE SET
                     action=excluded.action, reason=excluded.reason,
                     note=excluded.note, created_at=excluded.created_at""",
                (deal_id, member, action, reason, note, now()))


def fmt_earnings(row) -> str:
    if row["earnings"] is None: return "—"
    return f"${row['earnings']:,.0f}" + ("*" if row["earnings_is_sde"] else "")


# ------------------------------------------------------------------
# DEMO
# ------------------------------------------------------------------
if __name__ == "__main__":
    import ingest as ing

    # Demo runs against a scratch DB. In production set NM_DB to a path on
    # local disk (mounted/network filesystems break SQLite locking).
    DB = os.environ.get("NM_DB", "/tmp/nm_deals_demo.db")
    if os.path.exists(DB):
        os.remove(DB)
    con = connect(DB)

    kept, stats = ing.ingest(ing.EMAILS) if hasattr(ing, "EMAILS") else (None, None)

    modes = {"new": 0, "merged": 0, "repeat": 0}
    for l in kept:
        _, m = upsert(con, l)
        modes[m] += 1
    log_run(con, stats, modes["new"])
    con.commit()

    print("=" * 82)
    print(f"RUN 1  → {modes}")
    print("=" * 82)
    print(f"{'EARNINGS':>12} {'BASIS':<7}{'MARGIN':>8}  {'SOURCES':<22}{'LOC':<18}TITLE")
    print("-" * 82)
    for r in con.execute("SELECT * FROM v_deals ORDER BY earnings DESC NULLS LAST"):
        loc = ", ".join(x for x in [r["city"], r["state"]] if x) or "?"
        mg = f"{r['margin']*100:.1f}%" if r["margin"] else "—"
        print(f"{fmt_earnings(r):>12} {(r['earnings_basis'] or '—'):<7}{mg:>8}  "
              f"{(r['sources'] or ''):<22}{loc:<18}{r['title'][:26]}")

    # --- idempotency: same mail again ---
    modes2 = {"new": 0, "merged": 0, "repeat": 0}
    for l in ing.ingest(ing.EMAILS)[0]:
        _, m = upsert(con, l); modes2[m] += 1
    con.commit()
    n = con.execute("SELECT COUNT(*) c FROM deals").fetchone()["c"]
    print(f"\nRUN 2 (same mail) → {modes2}   total rows: {n}  ← no duplicates")

    # --- a later source discloses earnings a BizAlert email never carries ---
    # Confirmed against real mail: BizAlert gives asking price + location
    # ONLY, never EBITDA/SDE/revenue. So the realistic enrichment case isn't
    # "SDE upgraded to EBITDA" — it's "no earnings at all, until a broker
    # follow-up (or the buyer clicking through) discloses them."
    hvac = con.execute("SELECT * FROM v_deals WHERE title LIKE '%HVAC%'").fetchone()
    print(f"\nBefore: {hvac['title'][:38]}  asking=${hvac['asking']:,.0f}  "
          f"earnings={fmt_earnings(hvac)} ({hvac['earnings_basis']})")

    followup = ing.RawEmail("m9", "Broker <b@ctxbrokers.com>", "Updated financials", "2026-07-31", body="""
Established HVAC & Plumbing Company
Georgetown, TX
Revenue: $4,200,000
Adjusted EBITDA: $505,000
https://www.bizbuysell.com/Business-Opportunity/hvac-georgetown/2214412/
""")
    for l in ing.ingest([followup])[0]:
        upsert(con, l)
    con.commit()
    hvac = con.execute("SELECT * FROM v_deals WHERE title LIKE '%HVAC%'").fetchone()
    print(f"After:  {hvac['title'][:38]}  revenue=${hvac['revenue']:,.0f}  "
          f"earnings={fmt_earnings(hvac)} ({hvac['earnings_basis']})  "
          f"matched via: {'title similarity' if not hvac['url_norm'] else 'url'}")
    print(f"        sources: {hvac['sources']}   times_seen={hvac['times_seen']}")

    set_verdict(con, hvac["id"], "tristan", "pass", "Owner-dependent")
    set_verdict(con, hvac["id"], "partner", "short")
    con.commit()
    print("\nVerdicts (disagreement preserved, not averaged):")
    for v in con.execute("SELECT * FROM verdicts WHERE deal_id=?", (hvac["id"],)):
        print(f"   {v['member']:<9}{v['action']:<9}{v['reason'] or ''}")

    print("\n* = SDE (includes owner compensation)")
