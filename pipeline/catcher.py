"""
Catcher inbox vs who holds the OAuth.

Inbox stays dirk@tullyinvesting.com. Mailman holds the Gmail token that reads it.
Dirk the agent is not this connection.
"""
from __future__ import annotations

import os

HERE = os.path.dirname(os.path.abspath(__file__))
CRED_DIR = os.path.join(HERE, "credentials")

CATCHER_GMAIL = os.environ.get("CATCHER_GMAIL", "dirk@tullyinvesting.com").strip().lower()

CLIENT_SECRET = os.path.join(CRED_DIR, "client_secret.json")
MAILMAN_TOKEN = os.path.join(CRED_DIR, "mailman_token.json")


def gmail_query(days: int) -> str:
    addr = CATCHER_GMAIL
    return f"newer_than:{int(days)}d in:anywhere (deliveredto:{addr} OR to:{addr})"


def gmail_thread_url(thread_id: str | None) -> str:
    tid = (thread_id or "").strip()
    if not tid:
        return ""
    user = CATCHER_GMAIL.replace("@", "%40")
    return f"https://mail.google.com/mail/?authuser={user}#all/{tid}"
