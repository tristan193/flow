"""
CIM intake helper for Simon's agent.

After packs are ready (Drive file, Canva view link, or other https URL), POST
link + deal identity to Flow. One pack or a JSON batch.
Updates existing deals_next rows only. Does not create a card or vote.
Does not talk to Google Drive.

Single:
  python cim_intake.py \\
    --cim-url "https://drive.google.com/file/d/FILE_ID/view" \\
    --deal-number TLY-092

  python cim_intake.py \\
    --cim-url "https://www.canva.com/design/xxx/view" \\
    --deal-url "https://web-tau-seven-77.vercel.app/next/deals/TLY-014"

Batch (JSON array or {"cims": [...]}):
  python cim_intake.py --batch packs.json

Token: FLOW_IMPORT_TOKEN (required). Base URL: FLOW_APP_URL or --base.
Never print the token.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_BASE = "https://web-tau-seven-77.vercel.app"


def build_payload(args: argparse.Namespace) -> dict:
    payload: dict = {}
    if args.file_name:
        payload["fileName"] = args.file_name
    if args.cim_url:
        payload["cimUrl"] = args.cim_url
    if args.deal_number:
        payload["dealNumber"] = args.deal_number
    if args.deal_url:
        payload["dealUrl"] = args.deal_url
    if args.cim_name:
        payload["cimName"] = args.cim_name
    if args.city:
        payload["city"] = args.city
    if args.state:
        payload["state"] = args.state
    if args.country:
        payload["country"] = args.country
    if args.location:
        payload["location"] = args.location
    if args.county:
        payload["county"] = args.county
    if args.revenue is not None:
        payload["revenue"] = args.revenue
    if args.ebitda is not None:
        payload["ebitda"] = args.ebitda
    if args.margin is not None:
        payload["margin"] = args.margin
    if args.asking is not None:
        payload["asking"] = args.asking
    return payload


def load_batch(path: str) -> dict:
    with open(path, encoding="utf-8") as handle:
        raw = json.load(handle)
    if isinstance(raw, list):
        return {"cims": raw}
    if isinstance(raw, dict) and ("cims" in raw or "items" in raw):
        return raw
    if isinstance(raw, dict):
        return {"cims": [raw]}
    raise ValueError("batch file must be a JSON array or {\"cims\": [...]} object")


def post_intake(base: str, token: str, payload: dict | list) -> tuple[int, dict | str]:
    url = base.rstrip("/") + "/api/next/cim-intake"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode()
            try:
                return resp.status, json.loads(body)
            except json.JSONDecodeError:
                return resp.status, body
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode() if exc.fp else ""
        try:
            return exc.code, json.loads(raw) if raw else {"error": str(exc)}
        except json.JSONDecodeError:
            return exc.code, raw or str(exc)


def main() -> int:
    ap = argparse.ArgumentParser(description="Stamp CIM pack URL(s) onto existing TLY row(s).")
    ap.add_argument("--file-name", help="Drive filename, e.g. TLY-092 Headline.pdf")
    ap.add_argument("--cim-url", help="https pack URL (Drive file or Canva view link)")
    ap.add_argument("--deal-number", help="TLY-XXX (or a bare number, 92 → TLY-092)")
    ap.add_argument(
        "--deal-url",
        help="Flow deal URL, e.g. /next/deals/TLY-092 or https://…/cim/TLY-092",
    )
    ap.add_argument(
        "--batch",
        metavar="FILE",
        help='JSON file: [{"cimUrl":"https://…","dealNumber":"TLY-092"}, …]',
    )
    ap.add_argument(
        "--cim-name",
        help="CIM company / project / nickname (JSON key cimName → deals_next.cim_name)",
    )
    ap.add_argument("--city", help="HQ city (JSON key city → deals_next.city)")
    ap.add_argument(
        "--state",
        help="HQ state / region (JSON key state → deals_next.state). Foreign HQ can go here.",
    )
    ap.add_argument(
        "--country",
        help="Foreign HQ country. No deals_next.country column — writes state when state is omitted.",
    )
    ap.add_argument(
        "--location",
        help='Optional "City, ST" string parsed into city/state when those are missing',
    )
    ap.add_argument("--county", help="Optional county (never required)")
    ap.add_argument("--revenue", type=float)
    ap.add_argument("--ebitda", type=float)
    ap.add_argument("--margin", type=float, help="Ratio 0-1, or percent > 1 (22 → 0.22)")
    ap.add_argument("--asking", type=float)
    ap.add_argument(
        "--base",
        default=os.environ.get("FLOW_APP_URL", DEFAULT_BASE),
        help="Flow App origin (default FLOW_APP_URL or production)",
    )
    ap.add_argument(
        "--token",
        default=os.environ.get("FLOW_IMPORT_TOKEN", ""),
        help="Bearer token (default FLOW_IMPORT_TOKEN)",
    )
    args = ap.parse_args()

    token = (args.token or "").strip()
    if not token:
        print("error: --token or FLOW_IMPORT_TOKEN required", file=sys.stderr)
        return 1

    base = (args.base or "").strip()
    if not base.startswith("https://") and not base.startswith("http://"):
        print(
            f"error: --base must be a full URL starting with https:// (got {base[:40]!r})",
            file=sys.stderr,
        )
        return 1

    if args.batch:
        try:
            payload = load_batch(args.batch)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
    else:
        if not args.cim_url:
            print("error: --cim-url or --batch required", file=sys.stderr)
            return 1
        if not args.file_name and not args.deal_number and not args.deal_url:
            print("error: need --deal-number, --deal-url, or --file-name", file=sys.stderr)
            return 1
        payload = build_payload(args)

    status, body = post_intake(base, token, payload)
    if isinstance(body, dict):
        print(json.dumps(body, indent=2))
    else:
        print(body)
    if 200 <= status < 300:
        if isinstance(body, dict) and body.get("failed"):
            return 1
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
