"""Fixture proof for Rejigg + WebsiteClosers parsers (no live Gmail)."""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import ingest as ing
from formats.catalog import reload_catalog


def load_fixture(name: str) -> ing.RawEmail:
    raw = (HERE / "formats" / "fixtures" / name).read_text(encoding="utf-8")
    lines = raw.splitlines()
    sender = subject = ""
    body_start = 0
    for i, line in enumerate(lines):
        if line.upper().startswith("FROM:"):
            sender = line[5:].strip()
        elif line.upper().startswith("SUBJECT:"):
            subject = line[8:].strip()
        elif line.strip() == "":
            body_start = i + 1
            break
    return ing.RawEmail(
        msg_id=f"fixture:{name}",
        sender=sender,
        subject=subject,
        received="",
        body="\n".join(lines[body_start:]),
    )


def run(label: str, fixture: str, expect_family: str, min_blocks: int) -> bool:
    em = load_fixture(fixture)
    domain, email, nick = ing.attribution(em)
    matched = ing.classify_format(em, domain=domain, email=email)
    family = (
        matched.format_family
        if matched and matched.format_family
        else ing.format_family(em)
    )
    blocks = ing.blocks_for_email(em, matched=matched, family=family, email_addr=email)
    print(f"\n=== {label} ===")
    print(f"subject: {em.subject[:90]}")
    print(f"match: {matched.format_id if matched else None}  family={family}  nick={nick}")
    print(f"blocks: {len(blocks)}")
    listings = []
    for i, block in enumerate(blocks):
        lst = ing.extract(
            block,
            family,
            em.msg_id,
            i,
            source=domain,
            sub_source=email,
            nickname=nick,
            subject=em.subject,
            format_id=matched.format_id if matched else "",
        )
        listings.append(lst)
        print(
            f"  [{i+1}] {lst.title[:75]!r}"
            f"  rev={lst.revenue} ebitda={lst.ebitda} sde={lst.sde} ask={lst.asking}"
            f"  loc={lst.city or '—'},{lst.state or '—'}"
            f"  url={(lst.url or '')[:60]}"
        )

    checks = {
        "family": family == expect_family,
        "format": bool(matched and matched.format_id.startswith(expect_family.split("closers")[0] if False else "")),
        "blocks": len(blocks) >= min_blocks,
    }
    # clearer format check
    checks["format"] = bool(
        matched
        and (
            (expect_family == "rejigg" and matched.format_id == "rejigg.search_digest")
            or (
                expect_family == "websiteclosers"
                and matched.format_id == "websiteclosers.new_deal_alert"
            )
        )
    )
    if expect_family == "rejigg":
        checks["money"] = sum(1 for L in listings if L.revenue and L.ebitda) >= 2
        checks["titles"] = all(not ing._DIGEST_SUBJECT.search(L.title or "") for L in listings)
        checks["urls"] = sum(
            1 for L in listings if L.url and "rejigg.com/app/businesses" in L.url
        ) >= 2
        checks["nick"] = nick == "Rejigg"
    else:
        L = listings[0] if listings else None
        checks["money"] = bool(L and L.asking == 2_100_000 and L.revenue == 811_882 and L.sde == 537_072)
        checks["titles"] = bool(
            L and "Managed Hosting" in (L.title or "") and "New Business Listing" not in (L.title or "")
        )
        checks["urls"] = bool(L and L.url and "websiteclosers.com/businesses/" in L.url)
        checks["nick"] = nick == "WebsiteClosers"

    print("PROOF:", " ".join(f"{k}={'OK' if v else 'FAIL'}" for k, v in checks.items()))
    return all(checks.values())


if __name__ == "__main__":
    reload_catalog()
    a = run("Rejigg", "rejigg_search_digest.txt", "rejigg", 3)
    b = run("WebsiteClosers", "websiteclosers_new_deal_alert.txt", "websiteclosers", 1)
    # Before/after: generic newsletter on same Rejigg body
    em = load_fixture("rejigg_search_digest.txt")
    old = ing.split_newsletter(em.body, sender=em.sender)
    new = ing.split_rejigg(em.body)
    print(f"\n=== before vs after (Rejigg body) ===")
    print(f"generic newsletter blocks: {len(old)}  →  rejigg splitter: {len(new)}")
    sys.exit(0 if a and b else 1)
