"""
One-time OAuth: Mailman's access to the dirk@ catcher inbox.

  python gmail_auth.py
  python gmail_auth.py --reauth

Sign in as dirk@tullyinvesting.com. Writes credentials/mailman_token.json.
That file is Mailman's connection. Never commit it.

Scope is gmail.modify (read + archive). Archive only listing harvests — see mailman.py.
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

# modify includes read; needed to remove INBOX after listing harvest.
SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]
MODIFY_SCOPE = SCOPES[0]

# Import-time aliases for harvest_gmail helper signatures. get_credentials()
# re-reads catcher.*_path() when these are omitted.
DEFAULT_CLIENT = catcher.CLIENT_SECRET
DEFAULT_TOKEN = catcher.MAILMAN_TOKEN


def _running_in_ci() -> bool:
    return os.environ.get("GITHUB_ACTIONS") == "true" or os.environ.get("CI") == "true"


def _has_modify(creds: Credentials | None) -> bool:
    if not creds:
        return False
    granted = set(creds.scopes or [])
    if not granted:
        return False
    return MODIFY_SCOPE in granted or "https://mail.google.com/" in granted


def _ci_token_exit(reason: str) -> None:
    sys.exit(
        f"{reason}\n"
        "Cannot open a browser in GitHub Actions. Rotate repo secret GMAIL_TOKEN_JSON "
        "from a local `python gmail_auth.py --reauth` (sign in as dirk@) and keep "
        "GMAIL_CLIENT_SECRET_JSON in sync. Agents cannot write GitHub secrets."
    )


def get_credentials(
    client_secret: str | None = None,
    token_path: str | None = None,
    force_consent: bool = False,
) -> Credentials:
    client_secret = client_secret or catcher.client_secret_path()
    token_path = token_path or catcher.mailman_token_path()
    os.makedirs(os.path.dirname(token_path) or ".", exist_ok=True)

    creds: Credentials | None = None
    if not force_consent and os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    if creds and creds.valid and _has_modify(creds) and not force_consent:
        return creds

    if (
        creds
        and creds.expired
        and creds.refresh_token
        and _has_modify(creds)
        and not force_consent
    ):
        try:
            creds.refresh(Request())
            with open(token_path, "w", encoding="utf-8") as f:
                f.write(creds.to_json())
            return creds
        except Exception as exc:  # noqa: BLE001 — surface refresh failure
            if _running_in_ci():
                _ci_token_exit(f"Gmail token refresh failed in CI: {exc}")
            print(f"token refresh failed ({exc}); falling back to browser consent", file=sys.stderr)

    if _running_in_ci():
        _ci_token_exit(
            "Gmail token missing, expired, or lacks gmail.modify."
        )

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
    ap = argparse.ArgumentParser(description="Authorize Gmail modify for Mailman (read + archive)")
    ap.add_argument("--client", default=None, help="OAuth client JSON (default: catcher path)")
    ap.add_argument("--token", default=None, help="Token JSON (default: catcher mailman_token.json)")
    ap.add_argument("--reauth", action="store_true")
    args = ap.parse_args()

    token_path = args.token or catcher.mailman_token_path()
    creds = get_credentials(args.client, args.token, force_consent=args.reauth)
    email = verify_mailbox(creds)
    print(f"Connected as: {email}")
    print(f"Token saved:  {token_path}")
    print(f"Scopes:       {list(creds.scopes or SCOPES)}")
    expected = catcher.CATCHER_GMAIL
    if email.lower() != expected:
        print(
            f"\nWARNING: expected {expected} (catcher inbox).\n"
            "Re-run with --reauth and pick dirk@. This token is Mailman's access to that inbox."
        )
        sys.exit(2)
    if not _has_modify(creds):
        print("\nWARNING: token lacks gmail.modify — re-run with --reauth.")
        sys.exit(2)


if __name__ == "__main__":
    main()
