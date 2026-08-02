"""
Nails & Mercy — REAL BATCH RUN

Pulls the actual mail sitting under deals@tullyinvesting.com /
tw@tullyinvesting.com right now (fetched via the Gmail connector,
deliveredto: query, 2026-05-28 through 2026-07-30) through ingest.py's
pipeline and loads the result into deals.db — in the shared outputs folder,
not a scratch /tmp path.

Sources represented in this batch (all real, pasted verbatim from
plaintextBody / strip_html(htmlBody)):
    - BizAlert (BizBuySell)            — asking + location only, no financials
    - SMB Deal Hunter                  — "In Today's Issue" digest (5 items)
    - businessexits.com  x6            — Key Metrics Grid, bare "Profit" label
    - Benchmark International (TN)     — personal broker prose, Adj. EBITDA
    - Vanla Group                      — personal follow-up prose, no financials
    - doeren.com                       — CPA marketing, NOT a deal source
                                          (control: must yield 0 listings)
"""
import os, sys, csv, sqlite3, json
sys.path.insert(0, os.path.dirname(__file__))
import ingest as ing
import db

REAL_EMAILS = [
    ing.RawEmail("bizalert-1", "BizAlert <alerts@bizbuysell.com>",
        "3 New Business Matches: Central Texas", "2026-07-30", body=ing.EMAILS[0].body),

    # SMB Deal Hunter — real "In Today's Issue" digest, 2026-07-28.
    # Item order/text pasted verbatim from plaintextBody.
    ing.RawEmail("smb-hawaii", "helen@mail.smbdealhunter.xyz",
        "New Deals: A contract-backed Hawaii tour operator, two massage franchise locations with managers, and 3 other finds...",
        "2026-07-28", body="""
In Today's Issue:

#1: [Hawaii Tour Operator with Contract-Backed Revenue and $763K SDE](https://app.smbdealhunter.xyz/item-detail?recordId=rectxcuPHqTYCa8q1)

#2: [Two Massage Franchise Locations with Managers and $621K SDE](https://app.smbdealhunter.xyz/item-detail?recordId=recSJ0uaDEF2gvNiP)

#3: [Non-Emergency Medical Transport Company in IL with 4 Payer Channels and $720K SDE](https://app.smbdealhunter.xyz/item-detail?recordId=recUkcdwPBqkWFWe8)

#4: [Home Medical Supply Company in NJ with 4,000+ Referring Providers and $800K SDE](https://app.smbdealhunter.xyz/item-detail?recordId=recEakhSW7a67YDuj)

#5: [Industrial Parts Distributor in OR with Manager and $860K SDE](https://app.smbdealhunter.xyz/item-detail?recordId=recZpnvwlGM9Ey28g)
"""),

    # businessexits.com — Key Metrics Grid format. Earnings labeled bare
    # "Profit", no EBITDA/SDE qualifier — exercises the new SDE_PATS entry.
    ing.RawEmail("bizexits-swimwear", "inquiries@businessexits.com",
        "[For Sale] Swimwear Amazon Ecommerce Company – SBA Eligible", "2026-07-16", body="""
New Listing
Swimwear Amazon Ecommerce Company
SBA Eligible

Revenue (2025)
$3,256,592

Profit (2025)
$661,185

Asking Price
$2,000,000
3.02x multiple

Region
West (Remote Possible)

For sale is a well-established branded swimwear and aquatics products company in California with more than two decades of operating history, offering a diversified portfolio of specialty apparel, accessories, and performance products serving a loyal and recurring customer base.

Sign the NDA here (https://businessexits.com/listing/swimwear_ecommerce_sba_eligible/)
"""),

    ing.RawEmail("bizexits-plumbing-nw", "inquiries@businessexits.com",
        "Fast-Growing Plumbing Business in the Northwest", "2026-07-13", body="""
New Listing
Fast-Growing Plumbing Business
in the Northwest

Revenue (2026 Projection)
$7.71M

Profit (2026 Projection)
$2.7M

Asking Price
$16,000,000
5.9x multiple

Region
Northwest

For sale is a well-established residential and commercial plumbing and restoration company in the Northwest with more than a decade of operating history.

Sign the NDA here (https://businessexits.com/listing/fast_growing_plumbing_business_northwest/)
"""),

    ing.RawEmail("bizexits-vocational", "inquiries@businessexits.com",
        "Accredited Multi-Campus Vocational Education Company", "2026-07-14", body="""
New Listing
Accredited Multi-Campus Vocational
Education Company

Revenue (2023-2025 Avg)
$4.971M

Profit (2023-2025 Avg)
$2.32M

Asking Price
$10,000,000
4.3x multiple

Regions
Southwest and Southeast

For sale is a highly profitable, nationally accredited vocational training institution with more than four decades of operating history and three established campuses across the Gulf Coast and Southwest.

Sign the NDA here (https://businessexits.com/listing/multi_campus_vocational_company/)
"""),

    ing.RawEmail("bizexits-pa-landscaping", "inquiries@businessexits.com",
        "[For Sale] Pennsylvania Landscaping and a Material Production Company", "2026-06-15", body="""
New Listing
Pennsylvania Landscaping and a Material Production Company

Revenue (2025- both companies combined)
$4,422,798

Profit (2025- both companies combined)
$1,149,179

Asking Price
$3,500,000
3x multiple

Region
Northeast

For sale is a rare opportunity to acquire two highly complementary sister companies operating in the landscaping and material production industries in eastern Pennsylvania.

Sign the NDA here (https://businessexits.com/listing/landscaping_material_co/)
"""),

    # Benchmark International (Tennessee affiliate) — personal broker prose,
    # spells the state out in full ("Pennsylvania, United States"), uses the
    # recognized "Adj. EBITDA" label.
    ing.RawEmail("benchmark-glass-glazing", "Acquisitions@benchmarktennessee.com",
        "Acquisition Opportunity: Glass & Glazing Installation Contractor - BN000076672",
        "2026-07-06", body="""
Tristan,

We are representing a Glass & Glazing Installation Contractor that is seeking new ownership. The Company is fully owned by a single shareholder who is seeking to exit and pursue new opportunities. The owner is willing to remain with the Company for a transition period and is open to a variety of deal structures.

Here's a summary of the opportunity:

Location: Pennsylvania, United States

Description: The Company is a glass and glazing contractor that provides installation, repair, and replacement services for glass products in commercial buildings and residential homes. The Company has been in operation for over two decades.

Current Markets: The Company primarily serves commercial & residential contractors, developers, homeowners, and commercial building owners throughout Pennsylvania.

Financial Summary:

TY 2025 Revenue: $3.5M
TY 2023 Adj. EBITDA: $238K

Please contact me directly to discuss the opportunity further.

Ryan Anderson
Deal Analyst
Benchmark International
"""),

    # Vanla Group direct follow-up — prose, no inline financials, no location
    # at all. Should extract cleanly with needs_llm on both fields rather
    # than guessing.
    ing.RawEmail("vanla-direct-followup", "paul@vanlagroup.com",
        "Equipment Rental Company For Sale", "2026-07-07", body="""
Hi Tristan,

A while ago, you signed an NDA for an equipment rental company I have for sale. We have some updated financials and a potential deal structure to share with you.

The owner is willing to either seller-finance 10-20% or roll over 10% of the equity if you purchase the business.

I've attached a buyer package. Please let me know if you'd like me to resend the CIM.

Happy to jump on a call to discuss.

Paul Cheetham, BCA, CFP
Vanla Group
"""),

    # doeren.com — CPA firm content marketing. NOT a deal source. Control:
    # must yield 0 listings despite containing dollar figures.
    ing.RawEmail("doeren-oz-control", "info@doeren.com",
        "Opportunity Zones: What Investors Need to Do Before Dec. 31, 2026",
        "2026-07-30", body="""
If you're invested in an existing qualified opportunity fund, be aware of the December 31, 2026 deadline for capital gains deferral under the original Opportunity Zone program.

Investors who deferred capital gains by investing in a QOF have until this date to recognize the deferred gain, regardless of whether they have sold their QOF investment.

Our tax advisory team can help you evaluate next steps. Contact us to schedule a consultation.
"""),
]


def main():
    kept, stats = ing.ingest(REAL_EMAILS)

    print("=" * 82)
    print(f"REAL BATCH INGEST  raw={stats['raw']}  kept={stats['kept']}  merged={stats['merged']}")
    print(f"per-source (domain): {stats['per_source']}")
    print(f"per-sub-source (email): {stats['per_sub_source']}")
    print(f"per-nickname: {stats.get('per_nickname')}")
    print(f"per-family: {stats.get('per_family')}")
    for a in stats["alerts"]:
        print(f"  ! {a}")
    print("=" * 82)

    # The outputs folder is a FUSE mount — confirmed here, not hypothetical:
    # even a bare CREATE TABLE against it throws "disk I/O error", because
    # SQLite's file locking doesn't work over FUSE. This is the same family
    # of issue db.py's WAL comment already flagged, just hitting the default
    # rollback journal too, not only WAL mode. Build the live db on local
    # disk (where locking works), then copy the finished file to outputs as
    # a static artifact — Tristan can still open/query it, it just isn't
    # written-to-in-place on the mounted folder.
    LOCAL_DB = "/tmp/nm_deals_local.db"
    if os.path.exists(LOCAL_DB):
        os.remove(LOCAL_DB)
    con = db.connect(LOCAL_DB)

    modes = {"new": 0, "merged": 0, "repeat": 0}
    for l in kept:
        _, m = db.upsert(con, l)
        modes[m] += 1
    db.log_run(con, stats, modes["new"])
    con.commit()
    con.close()

    # Copy the finished file to outputs as a single write (no locking needed
    # for a byte copy — this is what actually makes it into the outputs
    # folder Tristan sees).
    OUT_DB = os.path.join(os.path.dirname(__file__), "nm_deals.db")
    with open(LOCAL_DB, "rb") as src, open(OUT_DB, "wb") as dst:
        dst.write(src.read())

    con = sqlite3.connect(LOCAL_DB)
    con.row_factory = sqlite3.Row

    print(f"\nDB LOAD  → {modes}   copied to: {OUT_DB}")
    print("-" * 82)

    rows = con.execute("SELECT * FROM v_deals ORDER BY earnings DESC NULLS LAST").fetchall()
    print(f"{'EARNINGS':>12} {'BASIS':<7}  {'NICKNAME':<22}{'LOC':<10}{'MODEL':<17}TITLE")
    print("-" * 82)
    for r in rows:
        loc = ", ".join(x for x in [r["city"], r["state"]] if x) or "?"
        needs = ", ".join(json.loads(r["needs_llm"] or "[]"))
        print(f"{db.fmt_earnings(r):>12} {(r['earnings_basis'] or '—'):<7}  "
              f"{(r['nickname'] or r['sub_source'] or '?'):<22}{loc:<10}{r['business_model_type']:<17}{r['title'][:40]}")
        if needs:
            print(f"             needs_llm: {needs}")

    # CSV export — a way to see the ingested records without SQL tooling.
    csv_path = os.path.join(os.path.dirname(__file__), "deals_export.csv")
    cols = ["title", "source", "sub_source", "nickname", "city", "state", "county",
            "business_model_type",
            "revenue", "ebitda", "sde", "asking", "earnings_basis",
            "sources", "url_norm", "needs_llm", "times_seen"]
    with open(csv_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in rows:
            w.writerow([r[c] for c in cols])

    print(f"\nCSV export: {csv_path}")
    print(f"Rows: {len(rows)}")


if __name__ == "__main__":
    main()
