"""One-off structure dump for repertoire rebuild from survey bodies."""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import ingest as ing  # noqa: E402

SURVEY = HERE / "survey" / "inbox_5d.json"
OUT = HERE / "survey" / "structure_notes.txt"


def nonempty_lines(body: str, n: int = 80) -> list[str]:
    return [ln.strip() for ln in body.splitlines() if ln.strip()][:n]


def body_text(path: str) -> str:
    raw = Path(path).read_text(encoding="utf-8")
    parts = raw.split("=" * 72, 1)
    return parts[1] if len(parts) > 1 else raw


def main() -> None:
    d = json.loads(SURVEY.read_text(encoding="utf-8"))
    lines_out: list[str] = []

    def p(s: str = "") -> None:
        lines_out.append(s)

    # --- inventory ---
    p(f"messages={d['message_count']} surveyed_at={d['surveyed_at']}")
    shapes = Counter()
    for r in d["messages"]:
        addr = (r["sender"].split("<")[-1].rstrip(">") if "<" in r["sender"] else r["sender"]).lower()
        subj = r["subject"] or ""
        if "newbizopps@" in addr:
            shapes["bbs.newbizopps_single"] += 1
        elif "bizalert@" in addr:
            shapes["bbs.bizalert_digest"] += 1
        elif "newdeal@" in addr:
            shapes["axial.single_deal"] += 1
        elif "notifications@" in addr and "action summary" in subj.lower():
            shapes["axial.action_summary"] += 1
        elif "smbdealhunter" in addr or "smbdealhunter" in (r.get("open_lines") or "").lower():
            if re.search(r"in today[’']?s issue", body_text(r["body_file"]), re.I):
                shapes["smb.digest"] += 1
            else:
                shapes["smb.editorial_marketing"] += 1
        elif "benchmark" in addr:
            shapes["benchmark.broker_thread"] += 1
        elif "gateway" in addr:
            shapes["gateway.subscription"] += 1
        elif "tullyinvesting" in addr:
            shapes["forward.tully"] += 1
        else:
            shapes[f"other:{addr}"] += 1
    p("SHAPE COUNTS:")
    for k, v in shapes.most_common():
        p(f"  {v:3d}  {k}")

    # --- newbizopps ---
    r = next(x for x in d["messages"] if "newbizopps@" in x["sender"].lower())
    body = body_text(r["body_file"])
    p("\n=== NEWBIZOPPS SAMPLE ===")
    p(f"subj: {r['subject']}")
    for i, ln in enumerate(nonempty_lines(body, 70)):
        p(f"{i:3d} {ln[:140]}")
    for lab in [
        "Asking Price",
        "Location",
        "Cash Flow",
        "Gross Income",
        "Revenue",
        "EBITDA",
        "Business Summary",
        "FF&E",
        "Inventory",
    ]:
        p(f"  label {lab!r}: {bool(re.search(re.escape(lab), body, re.I))}")

    # field presence across all newbizopps
    bbs = [x for x in d["messages"] if "newbizopps@" in x["sender"].lower()]
    p(f"\nnewbizopps count={len(bbs)}")
    for lab in ["Asking Price", "Cash Flow", "Gross Income", "Location:", "Business Summary"]:
        n = sum(1 for x in bbs if re.search(re.escape(lab), body_text(x["body_file"]), re.I))
        p(f"  {lab}: {n}/{len(bbs)}")

    # location line pattern
    loc_pat = re.compile(
        r"(?P<loc>[A-Za-z .'-]+(?:,\s*[A-Z]{2})?(?:\s*\([^)]+\))?):\s*\(https://www\.bizbuysell\.com/listings",
        re.I,
    )
    title_pat = re.compile(
        r"(?P<title>[^\n]{10,200}?)\s*\(https://www\.bizbuysell\.com/listings/Profile/[^\n]*utm_content=headline\)",
        re.I,
    )
    ask_pat = re.compile(r"Asking Price:\s*\$?([\d,]+)", re.I)
    hits = {"loc": 0, "title": 0, "ask": 0}
    for x in bbs:
        b = body_text(x["body_file"])
        if loc_pat.search(b):
            hits["loc"] += 1
        if title_pat.search(b):
            hits["title"] += 1
        if ask_pat.search(b):
            hits["ask"] += 1
    p(f"  draft regex hits loc/title/ask: {hits}")

    # --- axial newdeal ---
    r2 = next(x for x in d["messages"] if "newdeal@" in x["sender"].lower())
    body2 = body_text(r2["body_file"])
    p("\n=== AXIAL NEWDEAL SAMPLE ===")
    p(f"subj: {r2['subject']}")
    for i, ln in enumerate(nonempty_lines(body2, 45)):
        p(f"{i:3d} {ln[:140]}")
    blocks = ing.split_axial(body2)
    p(f"split_axial blocks={len(blocks)} (current splitter)")
    # whole body as single
    lst = ing.extract(body2, "axial", r2["msg_id"], 0, sub_src="Axial", subject=r2["subject"])
    p(
        f"whole-body extract title={lst.title[:70]!r} rev={lst.revenue} ebitda={lst.ebitda} "
        f"ask={lst.asking} city={lst.city} state={lst.state} needs={lst.needs_llm}"
    )

    # --- bizalert sender ---
    c = Counter()
    for x in d["messages"]:
        if x["sender_domain"] == "bizbuysell.com":
            addr = (x["sender"].split("<")[-1].rstrip(">") if "<" in x["sender"] else x["sender"]).lower()
            c[addr] += 1
    p(f"\nBBS senders: {dict(c)}")

    # --- smb subjects ---
    p("\n=== SMB SUBJECTS ===")
    for x in d["messages"]:
        if "smbdealhunter" in x["sender"].lower() or (
            "tullyinvesting" in x["sender"].lower()
            and "smbdealhunter" in body_text(x["body_file"]).lower()
        ):
            has_issue = bool(
                re.search(r"in today[’']?s issue", body_text(x["body_file"]), re.I)
            )
            p(
                f"  kept={x['kept_listings']} subj={(x['subject'] or '')[:80]!r} "
                f"todays_issue={has_issue}"
            )

    OUT.write_text("\n".join(lines_out), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
