"""
CIM intake helper for Simon's agent.

After the PDF is already in the shared Drive parent as `TLY-XXX Headline.pdf`,
POST the filename + Drive file view URL (and optional pack numbers) to Flow.
Updates the existing deals_next row only. Does not create a card or vote.
Does not talk to Google Drive.

  python cim_intake.py \\
    --file-name "TLY-092 Project Cactus.pdf" \\
    --cim-url "https://drive.google.com/file/d/FILE_ID/view" \\
    [--deal-number TLY-092] \\
    [--cim-name "Project Cactus"] \\
    [--revenue 4200000] [--ebitda 920000] [--margin 0.22] [--asking 6500000]

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
    payload = {
        "fileName": args.file_name,
        "cimUrl": args.cim_url,
    }
    if args.deal_number:
        payload["dealNumber"] = args.deal_number
    if args.cim_name:
        payload["cimName"] = args.cim_name
    if args.revenue is not None:
        payload["revenue"] = args.revenue
    if args.ebitda is not None:
        payload["ebitda"] = args.ebitda
    if args.margin is not None:
        payload["margin"] = args.margin
    if args.asking is not None:
        payload["asking"] = args.asking
    return payload


def post_intake(base: str, token: str, payload: dict) -> tuple[int, dict | str]:
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
    ap = argparse.ArgumentParser(description="Stamp a CIM pack onto an existing TLY row.")
    ap.add_argument("--file-name", required=True, help="Drive filename, e.g. TLY-092 Headline.pdf")
    ap.add_argument("--cim-url", required=True, help="Google Drive file view URL")
    ap.add_argument("--deal-number", help="Optional TLY-XXX; must match the filename")
    ap.add_argument(
        "--cim-name",
        help="CIM company / project / nickname (JSON key cimName → deals_next.cim_name)",
    )
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

    payload = build_payload(args)
    status, body = post_intake(base, token, payload)
    if isinstance(body, dict):
        print(json.dumps(body, indent=2))
    else:
        print(body)
    return 0 if 200 <= status < 300 else 1


if __name__ == "__main__":
    raise SystemExit(main())
