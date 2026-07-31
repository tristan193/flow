"""
One-time OAuth for the deal-catcher mailbox (dirk@tullyinvesting.com).

Prereqs (you do these in the browser / admin console — see README in this folder):
  1. dirk@ exists as a Google Workspace user
  2. Google Cloud project with Gmail API enabled
  3. OAuth Desktop client JSON saved as pipeline/credentials/client_secret.json

Then run (logged into Chrome as dirk@, or ready to pick that account):

  python gmail_auth.py

This writes pipeline/credentials/token.json (refresh token). Never commit it.
Later harvest runs reuse that file — no Claude / no interactive chat connector.
"""
from __future__ import annotations

import argparse
import os
import sys

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# readonly is enough to harvest; never request modify/send for this catcher.
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

HERE = os.path.dirname(os.path.abspath(__file__))
CRED_DIR = os.path.join(HERE, "credentials")
DEFAULT_CLIENT = os.path.join(CRED_DIR, "client_secret.json")
DEFAULT_TOKEN = os.path.join(CRED_DIR, "token.json")


def get_credentials(
    client_secret: str = DEFAULT_CLIENT,
    token_path: str = DEFAULT_TOKEN,
    force_consent: bool = False,
) -> Credentials:
    os.makedirs(os.path.dirname(token_path), exist_ok=True)

    creds: Credentials | None = None
    if not force_consent and os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        with open(token_path, "w", encoding="utf-8") as f:
            f.write(creds.to_json())
        return creds

    if not os.path.exists(client_secret):
        sys.exit(
            f"Missing OAuth client file:\n  {client_secret}\n\n"
            "Create a Desktop OAuth client in Google Cloud Console, download the JSON,\n"
            "and save it at that path (see pipeline/GMAIL_SETUP.md)."
        )

    flow = InstalledAppFlow.from_client_secrets_file(client_secret, SCOPES)
    # local server opens a browser; pick / sign in as dirk@ on that screen
    creds = flow.run_local_server(port=0, prompt="consent")
    with open(token_path, "w", encoding="utf-8") as f:
        f.write(creds.to_json())
    return creds


def verify_mailbox(creds: Credentials) -> str:
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    profile = service.users().getProfile(userId="me").execute()
    return profile.get("emailAddress", "(unknown)")


def main() -> None:
    ap = argparse.ArgumentParser(description="Authorize Gmail readonly for the catcher inbox")
    ap.add_argument("--client", default=DEFAULT_CLIENT, help="Path to OAuth client JSON")
    ap.add_argument("--token", default=DEFAULT_TOKEN, help="Where to write/read token.json")
    ap.add_argument(
        "--reauth",
        action="store_true",
        help="Ignore existing token and force a fresh consent screen",
    )
    args = ap.parse_args()

    creds = get_credentials(args.client, args.token, force_consent=args.reauth)
    email = verify_mailbox(creds)
    print(f"Connected as: {email}")
    print(f"Token saved:  {args.token}")
    if email.lower() != "dirk@tullyinvesting.com":
        print(
            "\nWARNING: expected dirk@tullyinvesting.com.\n"
            "If you signed in as yourself, re-run with --reauth and pick dirk@."
        )
        sys.exit(2)


if __name__ == "__main__":
    main()
