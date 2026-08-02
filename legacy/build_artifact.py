"""
Nails & Mercy — artifact builder.

Regenerates the deal-report HTML from nm_deals.db. Run this on every harvest;
do NOT hand-edit the generated HTML (changes get overwritten).

  python3 build_artifact.py [--member tristan|partner] [--out deal-report-v1.html]

Deal data is READ-ONLY in the artifact — it is baked in here, at build time.
The ONLY thing the artifact writes is verdicts, and it writes them as an
append-only JSON log to the shared Drive folder (see VERDICT SYNC below).
"""
import sqlite3, json, argparse, os, datetime

DRIVE_FOLDER = "0AIRHZYgxe1w-Uk9PVA"
# Connector-qualified tool name the artifact calls via window.cowork.callMcpTool.
# If the Drive connector is re-added the server id changes and this must be updated.
DRIVE_CREATE_TOOL = "mcp__41a53f27-8d43-4b07-9ee8-336cb2ad03ff__create_file"

HERE = os.path.dirname(os.path.abspath(__file__))


def bucket(src):
    s = (src or "").lower().replace(" ", "")
    for k in ("bizbuysell", "businessexits", "benchmark"):
        if k in s:
            return k
    return "newsletter"


def load_deals(con):
    rows = con.execute(
        "SELECT * FROM v_deals ORDER BY earnings DESC NULLS LAST").fetchall()
    out = []
    for r in rows:
        src = r["nickname"] or r["sub_source"] or (r["sources"] or "?")
        loc = ", ".join(x for x in [r["city"], r["state"]] if x) or None
        out.append({
            "id": r["ext_id"] or f"deal-{r['id']}",
            "title": r["title"],
            "loc": loc,
            "src": src,
            "srcbucket": bucket(src),
            "model": r["business_model_type"],
            "rev": r["revenue"],
            "ebitda": r["ebitda"],
            "sde": r["sde"],
            "asking": r["asking"],
            "basis": r["earnings_basis"],
            "needs": json.loads(r["needs_llm"] or "[]"),
            "url": r["url_norm"] or None,
            "blurb": (r["blurb"] or "")[:300],
        })
    return out


def load_baked_verdicts(con):
    """Verdicts already folded into the db by fold_verdicts.py — both members.

    These are baked in read-only. The artifact shows them but never edits
    another member's verdict; local edits layer on top for THIS member only.
    """
    baked = {}
    try:
        rows = con.execute(
            "SELECT d.ext_id AS ext_id, v.member, v.action, v.reason "
            "FROM verdicts v JOIN deals d ON d.id = v.deal_id").fetchall()
    except sqlite3.OperationalError:
        return baked
    for r in rows:
        baked.setdefault(r["ext_id"], {})[r["member"]] = {
            "act": r["action"], "reason": r["reason"]}
    return baked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--member", default="tristan", choices=["tristan", "partner"])
    ap.add_argument("--db", default=os.path.join(HERE, "nm_deals.db"))
    ap.add_argument("--out", default=os.path.join(HERE, "deal-report-v1.html"))
    a = ap.parse_args()

    con = sqlite3.connect(a.db)
    con.row_factory = sqlite3.Row
    deals = load_deals(con)
    baked = load_baked_verdicts(con)
    con.close()

    per = {}
    for d in deals:
        per[d["srcbucket"]] = per.get(d["srcbucket"], 0) + 1
    n_needs = sum(1 for d in deals if d["needs"])
    build_ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    tpl = open(os.path.join(HERE, "artifact_template.html")).read()
    html = (tpl
            .replace("__DEALS__", json.dumps(deals, indent=1))
            .replace("__BAKED__", json.dumps(baked, indent=1))
            .replace("__MEMBER__", a.member)
            .replace("__BUILD_TS__", build_ts)
            .replace("__DRIVE_FOLDER__", DRIVE_FOLDER)
            .replace("__DRIVE_CREATE_TOOL__", DRIVE_CREATE_TOOL)
            .replace("__N_DEALS__", str(len(deals)))
            .replace("__PER_SOURCE__", ", ".join(f"{k}: {v}" for k, v in sorted(per.items())))
            .replace("__N_NEEDS__", str(n_needs)))

    open(a.out, "w").write(html)
    print(f"built {a.out}  member={a.member}  deals={len(deals)}  "
          f"baked_verdicts={len(baked)}  {per}")


if __name__ == "__main__":
    main()
