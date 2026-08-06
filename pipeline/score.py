"""
Nails & Mercy — deal scoring engine v1.0
Deterministic. Reads buybox.yaml. Every score comes with a rationale trace
so the members can see *why* a deal surfaced (or didn't).

The LLM's job upstream is only NORMALIZATION + CLASSIFICATION
(extract ebitda, revenue, state, city, business_model_type, industry tags).
The accept/reject decision is rules-based and auditable. That separation is
deliberate: you can change the buy box without retraining anything, and a
bad LLM day can't silently drop a deal.
"""

import re, yaml, json
from dataclasses import dataclass, field
from typing import Optional, List, Dict

CFG = yaml.safe_load(open("buybox.yaml"))

TOLA = {"TX", "OK", "LA", "AR"}
CTX_METROS = {m.lower() for m in CFG["geography"]["G1_CENTRAL_TX"]["counties_or_metros"]}
CTX_COUNTIES = {c.lower() for c in CFG["geography"]["G1_CENTRAL_TX"]["counties"]}


@dataclass
class Deal:
    id: str
    title: str
    blurb: str
    source: str  # sender domain (attribution triad); see ingest.Listing
    city: Optional[str] = None
    state: Optional[str] = None
    county: Optional[str] = None
    revenue: Optional[float] = None
    ebitda: Optional[float] = None
    ebitda_is_sde: bool = False
    asking: Optional[float] = None
    business_model_type: str = "AMBIGUOUS"   # set by classifier
    url: str = ""


@dataclass
class Result:
    deal_id: str
    score: int = 0
    bucket: str = "D_suppress"
    geo_tier: str = ""
    fin_tier: str = ""
    strategic: bool = False
    rejected: bool = False
    reject_reason: str = ""
    trace: List[str] = field(default_factory=list)
    flags: List[str] = field(default_factory=list)


def _text(d: Deal) -> str:
    return f"{d.title} {d.blurb}".lower()


def _flatten(entries) -> List[str]:
    """YAML entries are written as comma-separated phrases for readability
    ('- water filtration, water filter'). Split them into real terms."""
    out = []
    for e in entries:
        out += [t.strip().lower() for t in str(e).split(",") if t.strip()]
    return out


def _hits(text: str, keywords) -> List[str]:
    """Word-boundary match. Substring matching produced false positives
    ('bar' inside 'barrier', 'contract' inside 'contractor')."""
    found = []
    for k in _flatten(keywords):
        if re.search(r"(?<!\w)" + re.escape(k) + r"(?!\w)", text):
            found.append(k)
    return found


# ---------------------------------------------------------------- geography
def classify_geo(d: Deal) -> str:
    if d.state and d.state.upper() not in {
        "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
        "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
        "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
        "VA","WA","WV","WI","WY","DC"}:
        return "G4_OUT"
    st = (d.state or "").upper()
    city = (d.city or "").lower()
    county = (d.county or "").lower().replace(" county", "")
    if st == "TX" and (
        any(m in city for m in CTX_METROS) or county in CTX_COUNTIES
    ):
        return "G1_CENTRAL_TX"
    if st in TOLA:
        return "G2_TOLA"
    if st:
        return "G3_NATIONAL"
    return "G3_NATIONAL"


# ---------------------------------------------------------------- financials
def classify_financials(d: Deal, r: Result):
    e = d.ebitda
    if e is None:
        r.flags.append(CFG["financial_tiers"]["unknown_financials"]["flag_in_ui"])
        return "T4", CFG["financial_tiers"]["unknown_financials"]["score_penalty"]
    if d.ebitda_is_sde:
        e = e * CFG["financial_tiers"]["sde_handling"]["sde_to_ebitda_haircut"]
        r.flags.append(CFG["financial_tiers"]["sde_handling"]["flag_in_ui"])
    margin = (e / d.revenue) if (d.revenue and d.revenue > 0) else None

    t1 = CFG["financial_tiers"]["T1"]
    if e >= t1["ebitda_min"] and margin is not None and margin >= t1["ebitda_margin_min"]:
        return "T1", t1["score"]
    if e >= t1["ebitda_min"] and margin is None:
        r.flags.append("Revenue unknown — margin unverified, capped at T2")
        return "T2", CFG["financial_tiers"]["T2"]["score"]
    if e >= CFG["financial_tiers"]["T2"]["ebitda_min"]:
        return "T2", CFG["financial_tiers"]["T2"]["score"]
    if e >= CFG["financial_tiers"]["T3"]["ebitda_min"]:
        return "T3", CFG["financial_tiers"]["T3"]["score"]
    return "T4", 0


TIER_RANK = {"T1": 3, "T2": 2, "T3": 1, "T4": 0}


# ---------------------------------------------------------------- industry
def check_strategic(text: str):
    hits = []
    for group, kws in CFG["industry"]["strategic_verticals"]["keywords"].items():
        hits += [(group, k) for k in _hits(text, kws)]
    return hits


def check_excluded(text: str):
    hits = []
    for cat, kws in CFG["industry"]["excluded"]["categories"].items():
        hits += [(cat, k) for k in _hits(text, kws)]
    return hits


# ---------------------------------------------------------------- main
def score(d: Deal) -> Result:
    r = Result(deal_id=d.id)
    text = _text(d)

    strat_hits = check_strategic(text)
    excl_hits = check_excluded(text)
    r.strategic = bool(strat_hits)

    # --- exclusions (strategic overrides) ---
    if excl_hits and not strat_hits:
        r.rejected = True
        cats = sorted({c for c, _ in excl_hits})
        r.reject_reason = f"Excluded category: {', '.join(cats)}"
        r.trace.append(f"EXCLUDED on {excl_hits[0][1]!r}")
        return r
    if excl_hits and strat_hits:
        r.flags.append("Excluded category, kept for strategic overlap — verify")

    # --- geography ---
    geo = classify_geo(d)
    r.geo_tier = geo
    if geo == "G4_OUT":
        r.rejected = True
        r.reject_reason = "Outside US"
        return r

    if geo == "G3_NATIONAL" and d.business_model_type == "LOCAL_SERVICE":
        r.rejected = True
        r.reject_reason = (
            f"Local-service business in {d.state} — outside TOLA service radius"
        )
        r.trace.append("GEO HARD REJECT: LOCAL_SERVICE outside TOLA")
        return r

    geo_score = CFG["geography"][geo]["score"]
    r.score += geo_score
    r.trace.append(f"Geography {CFG['geography'][geo]['label']}: +{geo_score}")

    # --- financials ---
    fin_tier, fin_score = classify_financials(d, r)
    r.fin_tier = fin_tier
    r.score += fin_score
    r.trace.append(f"Financials {fin_tier}: {fin_score:+d}")

    # --- visibility floors (earnings, or asking/revenue proxies) ---
    floor = CFG["geography"][geo].get("financial_floor", "T2")
    vis = CFG.get("visibility", {})
    corridor = geo == "G1_CENTRAL_TX"
    floor_amt = (
        vis.get("central_tx_ebitda_min", 350_000)
        if corridor
        else vis.get("elsewhere_ebitda_min", 750_000)
    )
    ask_min = (
        vis.get("central_tx_asking_min", 700_000)
        if corridor
        else vis.get("elsewhere_asking_min", 1_875_000)
    )
    rev_min = (
        vis.get("central_tx_revenue_min", 700_000)
        if corridor
        else vis.get("elsewhere_revenue_min", 1_500_000)
    )

    if not r.strategic:
        if d.ebitda is not None:
            eff = d.ebitda * (
                CFG["financial_tiers"].get("sde_to_ebitda_haircut", 0.85)
                if d.ebitda_is_sde
                else 1.0
            )
            if eff < floor_amt:
                r.rejected = True
                r.reject_reason = (
                    f"Earnings ${eff:,.0f} below visibility floor ${floor_amt:,.0f} "
                    f"for {CFG['geography'][geo]['label']}"
                )
                return r
            if TIER_RANK[fin_tier] < TIER_RANK[floor]:
                r.rejected = True
                r.reject_reason = (
                    f"{fin_tier} financials below {floor} floor for "
                    f"{CFG['geography'][geo]['label']}"
                )
                return r
        else:
            has_ask = d.asking is not None
            has_rev = d.revenue is not None
            if has_ask or has_rev:
                ask_ok = has_ask and d.asking >= ask_min
                rev_ok = has_rev and d.revenue >= rev_min
                if not (ask_ok or rev_ok):
                    r.rejected = True
                    r.reject_reason = (
                        f"No earnings; asking/revenue below visibility mins "
                        f"(need ${ask_min:,.0f} asking or ${rev_min:,.0f} revenue) "
                        f"for {CFG['geography'][geo]['label']}"
                    )
                    return r
            else:
                r.flags.append("Financials undisclosed — nothing to proxy")
                r.trace.append("Visibility waived: no earnings, asking, or revenue")
    if r.strategic:
        sv = CFG["industry"]["strategic_verticals"]
        r.score += sv["score_bonus"]
        groups = sorted({g for g, _ in strat_hits})
        r.trace.append(f"STRATEGIC ({', '.join(groups)}): +{sv['score_bonus']}")
        eff = (d.ebitda or 0) * (0.85 if d.ebitda_is_sde else 1.0)
        if d.ebitda is not None and eff < sv["absolute_ebitda_floor"]:
            r.flags.append("Sub-scale — tuck-in only")
        if TIER_RANK[fin_tier] < TIER_RANK[floor]:
            r.trace.append("Financial floor bypassed by strategic vertical")

    # --- modifiers ---
    for name, spec in CFG["modifiers"]["positive"].items():
        if _hits(text, spec["keywords"]):
            r.score += spec["score"]
            r.trace.append(f"+ {name.replace('_',' ')}: +{spec['score']}")
    for name, spec in CFG["modifiers"]["negative"].items():
        if _hits(text, spec["keywords"]):
            r.score += spec["score"]
            r.trace.append(f"- {name.replace('_',' ')}: {spec['score']}")

    # --- learned preferences ---
    for rule in CFG["learned"]["penalties"] + CFG["learned"]["boosts"]:
        if rule["evidence"] >= CFG["learned"]["min_evidence_to_apply"] \
           and rule["pattern"].lower() in text:
            w = max(-CFG["learned"]["max_learned_weight"],
                    min(CFG["learned"]["max_learned_weight"], rule["weight"]))
            r.score += w
            r.trace.append(f"~ learned {rule['pattern']!r}: {w:+d}")

    r.score = max(0, min(100, r.score))
    for bucket in ["A_priority", "B_review", "C_watch", "D_suppress"]:
        if r.score >= CFG["routing"][bucket]["min_score"]:
            r.bucket = bucket
            break
    return r


# ---------------------------------------------------------------- tests
if __name__ == "__main__":
    cases = [
        Deal("t1", "HVAC & Plumbing Company", "Established home services company, recurring maintenance contracts, owner will train. 20 techs.", "bizbuysell", city="Austin", state="TX", revenue=4_200_000, ebitda=620_000, business_model_type="LOCAL_SERVICE"),
        Deal("t2", "Commercial Water Filtration Systems", "Manufactures and services water filtration systems sold to hospitals and health systems nationally. Recurring filter replacement contracts.", "axial", city="Cleveland", state="OH", revenue=2_100_000, ebitda=410_000, business_model_type="NATIONAL"),
        Deal("t3", "Regional Home Services Platform", "Leading residential HVAC and plumbing provider across three states, strong management team in place.", "axial", city="Columbus", state="OH", revenue=12_000_000, ebitda=2_000_000, business_model_type="REGIONAL"),
        Deal("t4", "Vertical SaaS for Contractors", "Software as a service platform, $3M ARR, 90% gross margin, customers nationwide.", "newsletter", city="Dallas", state="TX", revenue=3_000_000, ebitda=900_000, business_model_type="NATIONAL"),
        Deal("t5", "Industrial Filter Media Manufacturer", "Manufacturer of filter media and cartridge filters, multi-year contract backlog with municipal water treatment plants nationwide.", "axial", city="Tulsa", state="OK", revenue=8_500_000, ebitda=1_400_000, business_model_type="NATIONAL"),
        Deal("t6", "Janitorial & Facilities Services", "Commercial janitorial serving office parks. Owner operated, one person operation handles sales.", "bizbuysell", city="Shreveport", state="LA", revenue=3_000_000, ebitda=800_000, business_model_type="LOCAL_SERVICE"),
        Deal("t7", "Backflow Prevention Testing Route", "Route-based backflow prevention testing and water quality compliance for municipalities.", "newsletter", city="San Antonio", state="TX", revenue=900_000, ebitda=280_000, business_model_type="LOCAL_SERVICE"),
        Deal("t8", "Precision Machining Company", "Contract manufacturer, ships nationally, long-term agreement with aerospace primes. Largest customer 40% of revenue.", "axial", city="Phoenix", state="AZ", revenue=9_000_000, ebitda=1_600_000, business_model_type="NATIONAL"),
        Deal("t9", "Iconic Mexican Restaurant", "Extremely profitable fast growing restaurant, turnkey, gold mine.", "bizbuysell", city="San Antonio", state="TX", revenue=2_000_000, ebitda=600_000, business_model_type="LOCAL_SERVICE"),
        Deal("t10", "Senior Living Facility Management Co", "Manages skilled nursing facility operations and long-term care facility services across three states.", "axial", city="Little Rock", state="AR", revenue=6_000_000, ebitda=520_000, business_model_type="REGIONAL"),
        Deal("t11", "Landscaping Company", "Commercial landscaping, recurring monthly service contracts.", "bizbuysell", city="Waco", state="TX", revenue=2_800_000, ebitda=None, business_model_type="LOCAL_SERVICE"),
        Deal("t12", "Specialty Distribution Business", "Wholesale distributor of industrial consumables shipping nationwide. Cash Flow reported.", "bizbuysell", city="Fort Worth", state="TX", revenue=5_000_000, ebitda=950_000, ebitda_is_sde=True, business_model_type="NATIONAL"),
    ]

    print(f"{'ID':<5}{'BUCKET':<13}{'SCR':<5}{'GEO':<16}{'FIN':<5}{'STRAT':<7}TITLE")
    print("-" * 108)
    for d in cases:
        r = score(d)
        b = "REJECT" if r.rejected else r.bucket
        print(f"{d.id:<5}{b:<13}{r.score:<5}{r.geo_tier:<16}{r.fin_tier:<5}"
              f"{'yes' if r.strategic else '-':<7}{d.title[:42]}")
        if r.rejected:
            print(f"      └─ {r.reject_reason}")
        else:
            for t in r.trace:
                print(f"      · {t}")
            for f in r.flags:
                print(f"      ⚑ {f}")
        print()
