"""
Catcher inbox vs who holds the OAuth.

Inbox stays dirk@tullyinvesting.com. Mailman holds the Gmail token that reads it.
Dirk the agent is not this connection.

Credential paths default to pipeline/credentials/. Override with env for CI
(temp files) without changing local docs:

  MAILMAN_CRED_DIR
  GMAIL_CLIENT_SECRET_PATH
  MAILMAN_TOKEN_PATH
"""
from __future__ import annotations

import os

HERE = os.path.dirname(os.path.abspath(__file__))


def cred_dir() -> str:
    return os.environ.get("MAILMAN_CRED_DIR", os.path.join(HERE, "credentials"))


def client_secret_path() -> str:
    return os.environ.get(
        "GMAIL_CLIENT_SECRET_PATH",
        os.path.join(cred_dir(), "client_secret.json"),
    )


def mailman_token_path() -> str:
    return os.environ.get(
        "MAILMAN_TOKEN_PATH",
        os.path.join(cred_dir(), "mailman_token.json"),
    )


CATCHER_GMAIL = os.environ.get("CATCHER_GMAIL", "dirk@tullyinvesting.com").strip().lower()

# Import-time aliases (local scripts). Prefer the functions above so CI env
# overrides are read at call time, not at import.
CRED_DIR = cred_dir()
CLIENT_SECRET = client_secret_path()
MAILMAN_TOKEN = mailman_token_path()


def gmail_query(days: int) -> str:
    addr = CATCHER_GMAIL
    return f"newer_than:{int(days)}d in:anywhere (deliveredto:{addr} OR to:{addr})"


def gmail_thread_url(thread_id: str | None) -> str:
    tid = (thread_id or "").strip()
    if not tid:
        return ""
    user = CATCHER_GMAIL.replace("@", "%40")
    return f"https://mail.google.com/mail/?authuser={user}#all/{tid}"
