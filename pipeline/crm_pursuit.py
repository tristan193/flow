"""
Pursuit CRM lane: classify non-discovery dirk@ mail → POST Flow /api/crm/pursuit.

  python crm_pursuit.py --days 5
  python crm_pursuit.py --days 3 --post https://web-….vercel.app --token $FLOW_IMPORT_TOKEN

Skips known listing digests. Detects NDA e-sign / NDA PDFs / CIM attachments /
VDR grants and sends match hints + optional file bytes.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import urllib.request
from email.utils import parseaddr
from typing import Any, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from googleapiclient.discovery import build

import gmail_auth
import harvest_gmail as hg
import ingest as ing

DISCOVERY_FORMATS = {
    "bizbuysell.newbizopps_digest",
    "bizbuysell.newbizopps_single",
    "bizbuysell.alert",
    "axial.single_deal",
    "axial.digest",
    "axial.teaser",
    "smb_deal_hunter.digest",
    "smb_deal_hunter.listing",
    "benchmark.teaser",
    "benchmark.digest",
    "vanla.teaser",
    "gateway.digest",
    "gateway.listing",
}

DISCOVERY_EMAIL_TYPES = {"daily_digest", "single_listing"}

ESIGN_DOMAINS = (
    "adobesign.com",
    "echosign.com",
    "docuSign.com",
    "docusign.net",
    "dropboxsign.com",
    "hellosign.com",
    "signnow.com",
)

NDA_URL_RE = re.compile(
    r"https?://[^\s<>\"']+(?:documents\.adobe|adobesign|echosign|dropboxsign|hellosign|docusign)[^\s<>\"']*",
    re.I,
)
ANY_HTTPS_RE = re.compile(r"https?://[^\s<>\"']+", re.I)
DEAL_NUM_RE = re.compile(r"\bdeal\s*#?\s*(\d{5,})", re.I)
LISTING_ID_RES = [
    re.compile(r"bizbuysell\.com/[^?\s]*[?&]q=(\d{5,})", re.I),
    re.compile(r"/business-opportunity/[^/\s]+/(\d{5,})", re.I),
    re.compile(r"rejigg\.com/app/businesses/(\d+)", re.I),
    re.compile(r"websiteclosers\.com/businesses/[^/\s]+/(\d+)", re.I),
    re.compile(r"axial\.net/[^\s]*opportunity/([a-f0-9-]{8,})", re.I),
]


def extract_listing_ids(*parts: str) -> list[str]:
    hay = "\n".join(p for p in parts if p)
    found: list[str] = []
    for cre in LISTING_ID_RES:
        found.extend(cre.findall(hay))
    # de-dupe, preserve order
    out: list[str] = []
    for x in found:
        if x not in out:
            out.append(x)
    return out


def _attachments_meta(payload: dict) -> list[dict]:
    found: list[dict] = []

    def walk(part: dict) -> None:
        filename = part.get("filename") or ""
        body = part.get("body") or {}
        mime = (part.get("mimeType") or "").lower()
        aid = body.get("attachmentId")
        if filename and aid:
            found.append(
                {
                    "filename": filename,
                    "mime": mime,
                    "size": body.get("size") or 0,
                    "attachmentId": aid,
                }
            )
        for child in part.get("parts") or []:
            walk(child)

    walk(payload or {})
    return found


def _download_attachment(service, msg_id: str, att_id: str) -> bytes:
    att = (
        service.users()
        .messages()
        .attachments()
        .get(userId="me", messageId=msg_id, id=att_id)
        .execute()
    )
    data = att.get("data") or ""
    return base64.urlsafe_b64decode(data.encode("utf-8"))


def is_discovery(matched, subject: str, sender: str) -> bool:
    if matched:
        if matched.format_id in DISCOVERY_FORMATS:
            return True
        if matched.email_type in DISCOVERY_EMAIL_TYPES:
            return True
        if matched.status == "control" and matched.format_id != "axial.action_summary":
            # Keep axial action summary for later; other control is noise
            if matched.email_type in ("newsletter_marketing", "account_notice"):
                return True
    subj = (subject or "").lower()
    if "new business opportunities" in subj:
        return True
    if "bizbuysell" in (sender or "").lower() and "alert" in subj:
        return True
    return False


def classify(
    subject: str,
    sender: str,
    body: str,
    attachments: list[dict],
) -> Optional[dict[str, Any]]:
    """Return event dict fields or None if not a pursuit signal."""
    subj = subject or ""
    body_l = (body or "")[:8000]
    text = f"{subj}\n{body_l}"
    _, addr = parseaddr(sender)
    domain = (addr.split("@")[-1] if "@" in addr else "").lower()

    pdfs = [
        a
        for a in attachments
        if (a["filename"] or "").lower().endswith((".pdf", ".doc", ".docx"))
    ]

    # E-sign NDA completed
    if re.search(r"you signed", subj, re.I) and re.search(r"\bnda\b", subj, re.I):
        return {
            "eventType": "nda_signed",
            "ndaUrl": None,
            "titleCue": re.sub(
                r'^you signed:\s*["\']?', "", subj, flags=re.I
            ).strip(" \"'"),
            "filePref": "signed_nda",  # do not treat as CIM
        }

    # E-sign NDA request
    if domain.endswith(ESIGN_DOMAINS) or re.search(
        r"signature requested|requests your signature", subj + body_l, re.I
    ):
        if re.search(r"\bnda\b", text, re.I):
            urls = NDA_URL_RE.findall(body_l) or [
                u for u in ANY_HTTPS_RE.findall(body_l) if "adobe" in u.lower() or "sign" in u.lower()
            ]
            return {
                "eventType": "nda_available",
                "ndaUrl": urls[0] if urls else None,
                "titleCue": re.sub(
                    r'^signature requested on\s*["\']?', "", subj, flags=re.I
                ).strip(" \"'"),
            }

    # CIM attachment (filename or subject)
    cim_pdfs = [
        a
        for a in pdfs
        if re.search(r"\bcim\b|offering.?memo|memorandum|\bom\b", a["filename"], re.I)
    ]
    if cim_pdfs or re.search(r"attached is our cim|attached.{0,20}\bcim\b", text, re.I):
        pick = cim_pdfs[0] if cim_pdfs else (pdfs[0] if pdfs else None)
        cue = re.sub(
            r"^tristan,?\s*attached is our cim for\s*",
            "",
            subj,
            flags=re.I,
        )
        cue = re.sub(r"\s*for your review\.?$", "", cue, flags=re.I).strip()
        return {
            "eventType": "cim_received",
            "ndaUrl": None,
            "titleCue": cue or subj,
            "attachment": pick,
        }

    # NDA PDF attachment from broker
    nda_pdfs = [
        a for a in pdfs if re.search(r"\bnda\b|non.?disclosure", a["filename"], re.I)
    ]
    if nda_pdfs and re.search(r"\bnda\b", text, re.I):
        m = DEAL_NUM_RE.search(text)
        return {
            "eventType": "nda_available",
            "ndaUrl": None,  # file is the NDA; thread link is the CTA
            "dealNumber": m.group(1) if m else None,
            "titleCue": subj,
            "attachment": None,  # don't store NDA as CIM
        }

    # Broker "I sent NDA via Dropbox/Adobe"
    if re.search(r"sent (an )?nda|sent nda|dropbox sign|please sign", text, re.I):
        urls = NDA_URL_RE.findall(body_l)
        num = DEAL_NUM_RE.search(text)
        return {
            "eventType": "nda_available",
            "ndaUrl": urls[0] if urls else None,
            "titleCue": re.sub(r"^sent nda:\s*", "", subj, flags=re.I).strip(),
            "dealNumber": num.group(1) if num else None,
        }

    # Baton / interest → NDA CTA
    if re.search(r"interest from bizbuysell|click here to (sign|complete).{0,12}nda", text, re.I):
        urls = ANY_HTTPS_RE.findall(body_l)
        nda_like = [u for u in urls if re.search(r"nda|sign|baton|bizbuysell", u, re.I)]
        return {
            "eventType": "nda_available",
            "ndaUrl": (nda_like or urls)[0] if (nda_like or urls) else None,
            "titleCue": subj,
        }

    # ShareFile / VDR
    if re.search(r"sharefile|virtual data room|has shared the folder|granted access", text, re.I):
        urls = ANY_HTTPS_RE.findall(body_l)
        return {
            "eventType": "vdr_access",
            "ndaUrl": urls[0] if urls else None,
            "titleCue": subj,
        }

    # Axial messenger
    if "axial.net" in domain and re.search(r"new message", text, re.I):
        return {
            "eventType": "broker_message",
            "ndaUrl": None,
            "titleCue": subj,
        }

    return None


def build_events(days: int) -> list[dict]:
    creds = gmail_auth.get_credentials()
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    q = f"newer_than:{days}d deliveredto:dirk@tullyinvesting.com in:anywhere"
    ids = hg.list_message_ids(service, q, max_results=400)
    events: list[dict] = []

    for mid in ids:
        msg = (
            service.users()
            .messages()
            .get(userId="me", id=mid, format="full")
            .execute()
        )
        headers = (msg.get("payload") or {}).get("headers") or []
        sender = hg._header(headers, "From")
        subject = hg._header(headers, "Subject")
        plain, html = hg._walk_parts(msg.get("payload") or {})
        body = ing.best_body(plain, html)
        atts = _attachments_meta(msg.get("payload") or {})
        thread_id = msg.get("threadId")
        _, addr = parseaddr(sender)
        domain = addr.split("@")[-1].lower() if "@" in addr else ""

        em = ing.RawEmail(
            msg_id=mid, sender=sender or addr, subject=subject, received="", body=body
        )
        matched = ing.classify_format(em, domain=domain, email=addr.lower())
        if is_discovery(matched, subject, sender):
            continue

        hit = classify(subject, sender, body, atts)
        if not hit:
            continue

        event: dict[str, Any] = {
            "gmailMessageId": mid,
            "gmailThreadId": thread_id,
            # authuser=dirk — /u/0 opens Tristan's default browser account
            "gmailThreadUrl": (
                "https://mail.google.com/mail/?authuser="
                "dirk%40tullyinvesting.com"
                f"#all/{thread_id}"
            )
            if thread_id
            else None,
            "subject": subject,
            "fromAddress": sender,
            "bodyText": (body or "")[:6000],
            "eventType": hit["eventType"],
            "ndaUrl": hit.get("ndaUrl"),
            "matchHints": {
                "dealNumber": hit.get("dealNumber"),
                "titleCue": hit.get("titleCue"),
                "listingIds": extract_listing_ids(subject, body, hit.get("titleCue") or ""),
            },
        }

        att = hit.get("attachment")
        if hit["eventType"] == "cim_received" and att and att.get("attachmentId"):
            try:
                raw = _download_attachment(service, mid, att["attachmentId"])
                if len(raw) <= 4 * 1024 * 1024:
                    event["fileBase64"] = base64.b64encode(raw).decode("ascii")
                    event["fileName"] = att["filename"]
                    event["fileContentType"] = att.get("mime") or "application/pdf"
            except Exception as exc:  # noqa: BLE001
                print(f"  warn: could not download {att.get('filename')}: {exc}")

        events.append(event)
        print(
            f"  + {hit['eventType']:14}  {(subject or '')[:70]}".encode("ascii", "replace").decode()
        )

    return events


def post_events(url: str, token: str, events: list[dict]) -> dict:
    endpoint = url.rstrip("/") + "/api/crm/pursuit"
    # Batch in chunks of 5 (files are large)
    all_results = []
    for i in range(0, len(events), 5):
        chunk = events[i : i + 5]
        payload = json.dumps({"events": chunk}).encode("utf-8")
        req = urllib.request.Request(
            endpoint,
            data=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            all_results.extend(data.get("results") or [])
            print(f"  posted chunk {i // 5 + 1}: {data.get('results')}")
    return {"results": all_results}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=5)
    ap.add_argument("--post", default="", help="Flow App base URL")
    ap.add_argument("--token", default=os.environ.get("FLOW_IMPORT_TOKEN", ""))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print(f"Scanning last {args.days}d for pursuit signals…")
    events = build_events(args.days)
    print(f"Found {len(events)} pursuit events")

    out = os.path.join(HERE, "_crm_pursuit_events.json")
    # Don't dump huge base64 to disk by default — strip for local inspect
    slim = []
    for e in events:
        s = {k: v for k, v in e.items() if k != "fileBase64"}
        if e.get("fileBase64"):
            s["fileBytes"] = len(base64.b64decode(e["fileBase64"]))
        slim.append(s)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(slim, f, indent=2)
    print(f"Wrote {out}")

    if args.dry_run or not args.post:
        print("Dry run (pass --post URL --token … to apply)")
        return
    if not args.token:
        print("FATAL: --token or FLOW_IMPORT_TOKEN required")
        sys.exit(1)
    post_events(args.post, args.token, events)


if __name__ == "__main__":
    main()
