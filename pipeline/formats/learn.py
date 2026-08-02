"""
Learn / maintain the format repertoire.

  python formats/learn.py summary
  python formats/learn.py classify [--survey path]
  python formats/learn.py propose [--survey path]   # write stubs for unmatched
  python formats/learn.py validate
  python formats/learn.py show <format_id>

Run from repo `pipeline/` (or any cwd — paths resolve from this file).
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
PIPE = HERE.parent
sys.path.insert(0, str(PIPE))

from formats.catalog import FormatCatalog, get_catalog, load_catalog, reload_catalog  # noqa: E402

SURVEY_DEFAULT = HERE / "survey" / "inbox_5d.json"
STUBS_DIR = HERE / "stubs"


def _load_survey(path: Path) -> dict:
    if not path.exists():
        raise SystemExit(
            f"Survey not found: {path}\n"
            f"Run: python survey_inbox.py --days 5"
        )
    return json.loads(path.read_text(encoding="utf-8"))


def cmd_validate(_: argparse.Namespace) -> None:
    cat = reload_catalog()
    print(f"OK  {cat.path}")
    print(f"    version={cat.version} updated={cat.updated}")
    print(f"    providers={len(cat.providers)} signals={len(cat.signals)} formats={len(cat.formats)}")
    print(f"    email_types={list(cat.email_types)}")
    by_status = Counter(f.status for f in cat.formats)
    for s, n in sorted(by_status.items()):
        print(f"    status {s}: {n}")
    web_meta = PIPE.parent / "web" / "lib" / "repertoire.meta.json"
    written = cat.write_meta_json(HERE / "repertoire.meta.json", web_meta)
    for p in written:
        print(f"    meta -> {p}")


def cmd_train_queue(args: argparse.Namespace) -> None:
    """Turn exported Train-AI flags into repertoire review notes under train/."""
    path = Path(args.input)
    if not path.exists():
        raise SystemExit(f"Train export not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data if isinstance(data, list) else data.get("flags") or data.get("reviews") or []
    out_dir = HERE / "train"
    out_dir.mkdir(parents=True, exist_ok=True)
    cat = get_catalog()
    stamped = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    written = 0
    for i, row in enumerate(rows):
        insp = row.get("inspection") or {}
        fmt_id = (
            row.get("format_id")
            or insp.get("format_id")
            or ""
        )
        deal_id = row.get("deal_id") or insp.get("deal_id") or i
        reason = row.get("reason") or ""
        detail = row.get("detail") or insp.get("detail") or ""
        slug = re_slug(f"{deal_id}_{reason}")[:60]
        target = out_dir / f"{stamped}_{slug}.md"
        fmt = cat.get(fmt_id) if fmt_id else None
        checklist = insp.get("checklist") or []
        focus = insp.get("focus_fields") or []
        lines = [
            f"# Train AI → repertoire review",
            "",
            f"- deal_id: {deal_id}",
            f"- ext_id: {row.get('ext_id') or insp.get('ext_id') or ''}",
            f"- reason: {reason}",
            f"- detail: {detail}",
            f"- format_id: {fmt_id or '(unmatched)'}",
            f"- source / sub_source: {row.get('source') or insp.get('source')} / "
            f"{row.get('sub_source') or insp.get('sub_source')}",
            f"- title: {row.get('title') or insp.get('title') or ''}",
            "",
            "## Repertoire target",
            "",
            f"Edit `{cat.path.name}` entry `{fmt_id or 'NEW FORMAT'}` "
            f"(playbook: docs/deal-format-repertoire.md).",
            "",
        ]
        if focus:
            lines += ["## Focus fields", "", *[f"- {f}" for f in focus], ""]
        if checklist:
            lines += ["## Inspection checklist", "", *[f"- [ ] {c}" for c in checklist], ""]
        if fmt:
            gotchas = fmt.raw.get("gotchas") or []
            gotcha_lines = [f"- {g}" for g in gotchas] or ["- (none)"]
            lines += [
                "## Current gotchas",
                "",
                *gotcha_lines,
                "",
                "## Suggested gotcha to append",
                "",
                f"- Train AI ({reason}): {detail or (row.get('title') or 'see deal')}",
                "",
            ]
        else:
            lines += [
                "## Action",
                "",
                "- No format matched — run `learn.py propose` after surveying the source mailbox,",
                "  or add a provider subcategory + format stub.",
                "",
            ]
        target.write_text("\n".join(lines), encoding="utf-8")
        written += 1
        print(f"wrote {target.name}")
    print(f"train reviews: {written} -> {out_dir}")


def re_slug(s: str) -> str:
    import re
    return re.sub(r"[^a-zA-Z0-9]+", "_", s).strip("_").lower() or "flag"


def cmd_summary(_: argparse.Namespace) -> None:
    cat = get_catalog()
    print("PROVIDERS -> SUBCATEGORIES (sender mailbox)")
    for p in cat.providers:
        print(f"  {p.get('nickname') or '?':28}  {p.get('domain')}")
        subs = [s for s in cat.subcategories if s.provider_domain == (p.get("domain") or "").lower()]
        if not subs:
            print("      (no subcategories yet)")
            continue
        for s in subs:
            df = s.default_format or "(body/subject decides)"
            print(f"      - {s.id:16}  {s.email:42}  -> {df}")
            if s.purpose:
                print(f"        {s.purpose[:88]}")
    if not cat.providers:
        print("  (none yet — add a providers: section to repertoire.yaml)")
    print("\nFORMATS")
    for f in cat.formats:
        sub = f.provider_subcategory or "-"
        print(
            f"  {f.id:42}  sub={sub:14}  {f.email_type:22}  {f.status:14}"
        )
    print("\nEMAIL TYPES")
    for name, meta in cat.email_types.items():
        desc = (meta or {}).get("description") or ""
        print(f"  {name:22}  {desc[:70]}")


def cmd_show(args: argparse.Namespace) -> None:
    cat = get_catalog()
    f = cat.get(args.format_id)
    if not f:
        raise SystemExit(f"Unknown format id: {args.format_id}")
    import yaml

    print(yaml.safe_dump(f.raw, sort_keys=False, allow_unicode=True))


def _classify_rows(cat: FormatCatalog, survey: dict) -> list[dict]:
    out = []
    for r in survey.get("messages") or []:
        m = cat.match(
            sender=r.get("sender") or "",
            subject=r.get("subject") or "",
            body=_body_from_row(r),
            source_domain=r.get("source") or "",
            sub_source_email=r.get("sub_source") or "",
        )
        out.append({
            "msg_id": r.get("msg_id"),
            "source": r.get("source"),
            "sub_source": r.get("sub_source"),
            "subject": r.get("subject"),
            "kept_listings": r.get("kept_listings"),
            "format_id": m.format_id if m else None,
            "provider_subcategory": m.provider_subcategory if m else None,
            "email_type": m.email_type if m else None,
            "status": m.status if m else None,
            "score": m.score if m else 0,
            "reasons": list(m.reasons) if m else [],
            "expected_yield": m and cat.get(m.format_id).expected_yield if m else None,
        })
    return out


def _body_from_row(r: dict) -> str:
    path = r.get("body_file")
    if not path:
        return ""
    p = Path(path)
    if not p.is_file():
        # Survey paths may be absolute from another machine — try local bodies/
        alt = HERE / "survey" / "bodies" / f"{r.get('msg_id')}.txt"
        p = alt if alt.is_file() else p
    if not p.is_file():
        return r.get("open_lines") or ""
    text = p.read_text(encoding="utf-8", errors="replace")
    if "=" * 20 in text:
        text = text.split("=" * 72, 1)[-1]
    return text


def cmd_classify(args: argparse.Namespace) -> None:
    cat = get_catalog()
    survey = _load_survey(Path(args.survey) if args.survey else SURVEY_DEFAULT)
    rows = _classify_rows(cat, survey)
    by_fmt = Counter(r["format_id"] or "(unmatched)" for r in rows)
    by_sub = Counter(r["provider_subcategory"] or "(none)" for r in rows if r["format_id"])
    print(f"classified {len(rows)} messages against {cat.path.name}\n")
    print("BY PROVIDER SUBCATEGORY (sender mailbox)")
    for k, n in by_sub.most_common():
        print(f"  {n:3d}  {k}")
    print("\nBY FORMAT")
    for k, n in by_fmt.most_common():
        print(f"  {n:3d}  {k}")

    unmatched = [r for r in rows if not r["format_id"]]
    needs_parser = [r for r in rows if r["status"] == "needs_parser"]
    print(f"\nunmatched: {len(unmatched)}")
    for r in unmatched[:25]:
        subj = (r["subject"] or "")[:70].encode("ascii", "replace").decode("ascii")
        print(f"  - [{r['source']}/{r['sub_source']}] {subj}")
    print(f"\nneeds_parser (known format, no splitter yet): {len(needs_parser)}")
    for r in needs_parser[:10]:
        subj = (r["subject"] or "")[:60].encode("ascii", "replace").decode("ascii")
        print(f"  - {r['format_id']}  kept={r['kept_listings']}  {subj}")

    # Yield sanity: control formats should keep 0
    bad_control = [
        r for r in rows
        if r["status"] in ("control",) and (r.get("kept_listings") or 0) > 0
    ]
    if bad_control:
        print(f"\nWARN: control formats still yielding listings: {len(bad_control)}")


def cmd_propose(args: argparse.Namespace) -> None:
    try:
        import yaml
    except ImportError as e:
        raise SystemExit("PyYAML required") from e

    cat = get_catalog()
    survey = _load_survey(Path(args.survey) if args.survey else SURVEY_DEFAULT)
    rows = _classify_rows(cat, survey)
    unmatched = [r for r in rows if not r["format_id"]]
    if not unmatched:
        print("Nothing to propose — every surveyed message matched a format.")
        return

    STUBS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    # Group by sub_source so one stub covers a mailbox.
    groups: dict[str, list] = {}
    for r in unmatched:
        key = (r.get("sub_source") or r.get("source") or "unknown").lower()
        groups.setdefault(key, []).append(r)

    written = []
    for key, group in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        sample = group[0]
        draft = cat.unmatched_provider_hint(
            sample.get("source") or "",
            sample.get("sub_source") or "",
        )
        draft["survey_unmatched_count"] = len(group)
        draft["subject_examples"] = [
            (g.get("subject") or "") for g in group[:5] if g.get("subject")
        ]
        draft["open_line_examples"] = []
        for g in group[:3]:
            # Prefer open_lines from survey row
            for msg in survey.get("messages") or []:
                if msg.get("msg_id") == g.get("msg_id"):
                    draft["open_line_examples"].append(msg.get("open_lines") or "")
                    break
        safe = key.replace("@", "_at_").replace(".", "_")
        path = STUBS_DIR / f"{stamp}_{safe}.yaml"
        path.write_text(
            "# PROPOSED STUB — review, enrich, then merge into repertoire.yaml\n"
            "# Do not load stubs automatically.\n"
            + yaml.safe_dump(draft, sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )
        written.append(path)

    print(f"wrote {len(written)} stub(s) under {STUBS_DIR}")
    for p in written:
        print(f"  {p.name}")
    print("\nNext: edit stub → paste into repertoire.yaml formats: → learn.py validate")


def main() -> None:
    ap = argparse.ArgumentParser(description="Format repertoire learn/maintain CLI")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("validate", help="Load and validate repertoire.yaml")
    sub.add_parser("summary", help="List providers, formats, email types")
    p_show = sub.add_parser("show", help="Dump one format entry as YAML")
    p_show.add_argument("format_id")

    p_cls = sub.add_parser("classify", help="Match survey messages to formats")
    p_cls.add_argument("--survey", default=str(SURVEY_DEFAULT))

    p_prop = sub.add_parser("propose", help="Write stubs for unmatched survey mail")
    p_prop.add_argument("--survey", default=str(SURVEY_DEFAULT))

    p_train = sub.add_parser(
        "train-queue",
        help="Turn exported Train-AI JSON into repertoire review notes under formats/train/",
    )
    p_train.add_argument(
        "--input",
        required=True,
        help="JSON from GET /api/train or a manual export ({flags:[…]} or a list)",
    )

    args = ap.parse_args()
    {
        "validate": cmd_validate,
        "summary": cmd_summary,
        "show": cmd_show,
        "classify": cmd_classify,
        "propose": cmd_propose,
        "train-queue": cmd_train_queue,
    }[args.cmd](args)


if __name__ == "__main__":
    main()
