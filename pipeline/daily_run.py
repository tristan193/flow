"""
Nails & Mercy — DAILY HARVEST RUN (2026-07-30)

Same shape as populate_real.py, but the email bodies come from the Gmail
connector's live 3-day lookback rather than a pasted fixture set. Deal mail
bodies are read verbatim from the connector's persisted tool-result JSON
(the get_thread responses were too large to return inline).

The four transactional / non-deal messages in the window (Axial account
notice, two AgencyEquity account notices, a personal "Test" mail) are
carried as faithful text renderings of their visible body content rather
than raw HTML — all four are expected-zero-yield controls and are included
so the run exercises them rather than quietly skipping them.
"""
import os, sys, csv, json, glob, sqlite3, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ingest as ing
import db

TOOL_RESULTS = os.environ["NM_TOOL_RESULTS"]
LOCAL_DB = os.environ.get("NM_LOCAL_DB", os.path.expanduser("~/nmwork/nm_deals_local.db"))

# msg_id -> (sender, subject, date) for the deal mail pulled off disk.
FROM_DISK = {
    "19fb4db909a4fade": "smb-2026-07-30",
    "19fafbb1ad4ebf8d": "smb-2026-07-29",
    "19faa89f990d8cda": "smb-hawaii",       # same digest already in the db
    "19fb3fadd0523539": "doeren-oz-control",
}


def load_disk_emails():
    out = []
    for f in sorted(glob.glob(os.path.join(TOOL_RESULTS, "*get_thread*.txt"))):
        d = json.load(open(f, encoding="utf-8"))
        for m in d["messages"]:
            if m["id"] not in FROM_DISK:
                continue
            body = ing.best_body(m.get("plaintextBody"), m.get("htmlBody"))
            out.append(ing.RawEmail(FROM_DISK[m["id"]], m["sender"],
                                    m["subject"], m["date"], body=body))
    return out


# --- expected-zero-yield transactional controls -----------------------
CONTROLS = [
    ing.RawEmail("axial-email-change", "Axial <notifications@axial.net>",
        "Updated Email Address", "2026-07-30T17:21:23Z", body="""
Your Email Address Has Changed

The email address for your profile has been updated to tw@tullyinvesting.com. This new address is now the one you should use when you log into Axial.

If you did not make this change, if you think the change was made in error, or for any further assistance, please contact the team at Axial:

help@axial.net

Thank you,
The Axial Team

2010-2025 Axial Networks, Inc. All Rights Reserved.
Account (https://network.axial.net)
Notification Preferences (https://network.axial.net/user/notifications-settings)
Help Center (https://guide.axial.net)
"""),

    ing.RawEmail("agencyequity-approved", "admin@agencyequity.com",
        "Email Approved", "2026-07-30T18:12:18Z", body="""
Hello tristan!

Your new primary email has been approved.

Sponsored Message
Need due diligence assistance or a valuation on an agency you are acquiring?
We can help. Give us a call at (321) 255-1309.
Agency Brokerage Consultants

Strategic Agencies LLC
533 Airport Blvd, Suite 400, Burlingame, CA 94010
Copyright 2023 All Rights Reserved
"""),

    ing.RawEmail("agencyequity-confirm", "admin@agencyequity.com",
        "Confirm your New Primary Email", "2026-07-30T17:13:44Z", body="""
You have added a new primary email address. Please verify ownership by clicking the link below:

Verify my primary email address

Please note that updating the primary email is subject to admin approval.
"""),

    ing.RawEmail("personal-test", "tconsumer@hotmail.com",
        "Test", "2026-07-30T17:12:02Z", body="Sent from my iPhone"),
]


def main():
    emails = load_disk_emails() + CONTROLS
    print(f"emails fetched: {len(emails)}")
    for e in emails:
        print(f"   {e.msg_id:<24} {ing.route(e):<14} {ing.sub_source(e):<28} "
              f"body={len(e.body)}")

    kept, stats = ing.ingest(emails)
    print("=" * 82)
    print(f"INGEST  raw={stats['raw']}  kept={stats['kept']}  merged={stats['merged']}")
    print(f"per-source:     {stats['per_source']}")
    print(f"per-sub-source: {stats['per_sub_source']}")
    for a in stats["alerts"]:
        print(f"  ! {a}")
    print("=" * 82)

    con = db.connect(LOCAL_DB)
    modes = {"new": 0, "merged": 0, "repeat": 0}
    for l in kept:
        _, m = db.upsert(con, l)
        modes[m] += 1
    db.log_run(con, stats, modes["new"])
    con.commit()
    con.close()
    print(f"DB LOAD → {modes}")

    # CSV export — same columns and order as populate_real.py.
    con = sqlite3.connect(LOCAL_DB)
    con.row_factory = sqlite3.Row
    rows = con.execute("SELECT * FROM v_deals ORDER BY earnings DESC NULLS LAST").fetchall()
    cols = ["title", "sub_source", "city", "state", "county", "business_model_type",
            "revenue", "ebitda", "sde", "asking", "earnings_basis",
            "sources", "url_norm", "needs_llm", "times_seen"]
    csv_path = os.path.join(HERE, "deals_export.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in rows:
            w.writerow([r[c] for c in cols])
    print(f"CSV export: {csv_path}   rows={len(rows)}")

    print("-" * 82)
    for r in rows:
        loc = ", ".join(x for x in [r["city"], r["state"]] if x) or "?"
        print(f"{db.fmt_earnings(r):>12} {(r['earnings_basis'] or '—'):<7}  "
              f"{(r['sub_source'] or '?'):<24}{loc:<12}{r['title'][:44]}")
    con.close()
    json.dump({"modes": modes, "stats": stats},
              open(os.path.join(os.path.dirname(LOCAL_DB), "run_stats.json"), "w"),
              indent=2)


if __name__ == "__main__":
    main()
