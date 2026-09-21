"""Smoke tests: Mailman labels, catcher paths, gmail_thread_url.

  python test_mailman.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import catcher
import db
import ingest as ing
import mailman


class CatcherPathTests(unittest.TestCase):
    def test_gmail_thread_url_dirk_all_mail(self) -> None:
        url = catcher.gmail_thread_url("18f0threadAAA")
        self.assertIn("authuser=dirk%40tullyinvesting.com", url)
        self.assertTrue(url.endswith("#all/18f0threadAAA"))
        self.assertEqual(catcher.gmail_thread_url(""), "")
        self.assertEqual(catcher.gmail_thread_url(None), "")

    def test_token_path_env_override(self) -> None:
        with mock.patch.dict(os.environ, {"MAILMAN_TOKEN_PATH": "/tmp/ci-mailman-token.json"}):
            self.assertEqual(catcher.mailman_token_path(), "/tmp/ci-mailman-token.json")

    def test_client_secret_path_env_override(self) -> None:
        with mock.patch.dict(os.environ, {"GMAIL_CLIENT_SECRET_PATH": "/tmp/ci-client.json"}):
            self.assertEqual(catcher.client_secret_path(), "/tmp/ci-client.json")

    def test_cred_dir_env_override(self) -> None:
        stale = {
            k: os.environ.pop(k)
            for k in ("MAILMAN_TOKEN_PATH", "GMAIL_CLIENT_SECRET_PATH")
            if k in os.environ
        }
        try:
            with mock.patch.dict(os.environ, {"MAILMAN_CRED_DIR": "/tmp/ci-creds"}):
                self.assertEqual(
                    catcher.mailman_token_path(),
                    os.path.join("/tmp/ci-creds", "mailman_token.json"),
                )
        finally:
            os.environ.update(stale)


class MailmanLabelTests(unittest.TestCase):
    def test_label_for_email_type(self) -> None:
        self.assertEqual(mailman.label_for_email_type("single_listing"), "listing")
        self.assertEqual(mailman.label_for_email_type("daily_digest"), "listing")
        self.assertEqual(mailman.label_for_email_type("follow_up"), "follow_up")
        self.assertEqual(mailman.label_for_email_type("account_notice"), "control")
        self.assertEqual(mailman.label_for_email_type("newsletter_marketing"), "noise")
        self.assertEqual(mailman.label_for_email_type(""), "unknown")
        self.assertEqual(mailman.label_for_email_type(None), "unknown")

    def test_self_test(self) -> None:
        mailman._self_test()

    def test_upsert_requires_thread_fields(self) -> None:
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        try:
            con = db.connect(tmp.name)
            tid = "18f0threadAAA"
            url = catcher.gmail_thread_url(tid)
            mode = db.upsert_mail(
                con,
                gmail_id="msg-1",
                thread_id=tid,
                gmail_thread_url=url,
                sender="BizAlert <alerts@bizbuysell.com>",
                subject="matches",
                received="2026-09-21",
                body="hi",
                label="listing",
            )
            self.assertEqual(mode, "new")
            row = con.execute("SELECT thread_id, gmail_thread_url, label FROM mail").fetchone()
            self.assertEqual(row["thread_id"], tid)
            self.assertEqual(row["gmail_thread_url"], url)
            self.assertEqual(row["label"], "listing")
            con.close()
        finally:
            os.unlink(tmp.name)

    def test_classify_does_not_extract_listing(self) -> None:
        em = ing.RawEmail(
            "m1",
            "BizAlert <alerts@bizbuysell.com>",
            "5 New Business Matches in Texas",
            "2026-09-18",
            body="Asking Price: $1,000,000\nhttps://www.bizbuysell.com/business-opportunity/x/123/?q=123",
        )
        label, _fmt_id, _em_type = mailman.classify_mail(em)
        self.assertIn(label, {"listing", "unknown"})


class GmailAuthCiTests(unittest.TestCase):
    def test_ci_refuses_browser_oauth(self) -> None:
        import gmail_auth

        with tempfile.TemporaryDirectory() as td:
            token = os.path.join(td, "mailman_token.json")
            client = os.path.join(td, "client_secret.json")
            with mock.patch.dict(
                os.environ,
                {
                    "GITHUB_ACTIONS": "true",
                    "MAILMAN_TOKEN_PATH": token,
                    "GMAIL_CLIENT_SECRET_PATH": client,
                },
            ):
                with self.assertRaises(SystemExit) as ctx:
                    gmail_auth.get_credentials()
                msg = str(ctx.exception)
                self.assertIn("GMAIL_TOKEN_JSON", msg)
                self.assertIn("Cannot open a browser", msg)


if __name__ == "__main__":
    unittest.main()
