"""
One-time OAuth: Mailman's access to the dirk@ catcher inbox.

  python gmail_auth.py

Sign in as dirk@tullyinvesting.com. Writes credentials/mailman_token.json.
That file is Mailman's connection. Never commit it.
"""
from __future__ import annotations

import argparse
import os
import sys

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

import catcher

# readonly is enough to harvest; never request modify/send for this catcher.
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

DEFAULT_CLIENT = catcher.CLIENT_SECRET
DEFAULT_TOKEN = catcher.MAILMAN_TOKEN


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
    creds = flow.run_local_server(port=0, prompt="consent")
    with open(token_path, "w", encoding="utf-8") as f:
        f.write(creds.to_json())
    return creds


def verify_mailbox(creds: Credentials) -> str:
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    profile = service.users().getProfile(userId="me").execute()
    return profile.get("emailAddress", "(unknown)")


def main() -> None:
    ap = argparse.ArgumentParser(description="Authorize Gmail readonly for Mailman")
    ap.add_argument("--client", default=DEFAULT_CLIENT)
    ap.add_argument("--token", default=DEFAULT_TOKEN)
    ap.add_argument("--reauth", action="store_true")
    args = ap.parse_args()

    creds = get_credentials(args.client, args.token, force_consent=args.reauth)
    email = verify_mailbox(creds)
    print(f"Connected as: {email}")
    print(f"Token saved:  {args.token}")
    expected = catcher.CATCHER_GMAIL
    if email.lower() != expected:
        print(
            f"\nWARNING: expected {expected} (catcher inbox).\n"
            "Re-run with --reauth and pick dirk@. This token is Mailman's access to that inbox."
        )
        sys.exit(2)


if __name__ == "__main__":
    main()
