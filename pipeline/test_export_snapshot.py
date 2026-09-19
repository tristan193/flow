"""Smoke tests: harvest snapshot emits gmailThreadIds + listing url.

  python test_export_snapshot.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import db
import export_snapshot as exp
import ingest as ing


def _seed_deal(con, *, ext_id: str, title: str, url_norm: str, msg_id: str, source_url: str = "") -> int:
    con.execute(
        """
        INSERT INTO deals (
          ext_id, fingerprint, url_norm, title, blurb, source, sub_source, nickname,
          city, state, first_seen, last_seen, times_seen
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        """,
        (
            ext_id,
            "fp",
            url_norm,
            title,
            "blurb",
            "bizbuysell.com",
            "bizalert@bizbuysell.com",
            "BizBuySell",
            "Austin",
            "TX",
            "2026-09-18T00:00:00+00:00",
            "2026-09-18T00:00:00+00:00",
        ),
    )
    did = con.execute("SELECT id FROM deals WHERE ext_id=?", (ext_id,)).fetchone()["id"]
    con.execute(
        """INSERT INTO deal_sources (deal_id, source, msg_id, url, seen_at)
           VALUES (?, ?, ?, ?, ?)""",
        (did, "bizbuysell.com", msg_id, source_url or url_norm, "2026-09-18T00:00:00+00:00"),
    )
    return int(did)


class ExportSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.db_path = self.tmp.name
        self.con = db.connect(self.db_path)

    def tearDown(self) -> None:
        self.con.close()
        os.unlink(self.db_path)

    def test_gmail_thread_ids_from_mail_thread_id(self) -> None:
        _seed_deal(
            self.con,
            ext_id="bbs:msgA:0",
            title="HVAC shop",
            url_norm="https://www.bizbuysell.com/business-opportunity/hvac/2214412",
            msg_id="gmail-msg-aaa",
        )
        db.upsert_mail(
            self.con,
            gmail_id="gmail-msg-aaa",
            thread_id="18f0threadAAA",
            sender="BizAlert <alerts@bizbuysell.com>",
            subject="matches",
            received="2026-09-18",
            body="https://www.bizbuysell.com/business-opportunity/hvac/2214412",
            label="listing",
        )
        # Confirm message id ≠ thread id in this DB — do not substitute.
        row = self.con.execute(
            "SELECT gmail_id, thread_id FROM mail WHERE gmail_id=?",
            ("gmail-msg-aaa",),
        ).fetchone()
        self.assertNotEqual(row["gmail_id"], row["thread_id"])
        self.con.commit()

        payload = exp.export(self.db_path)
        deal = payload["deals"][0]
        self.assertEqual(deal["gmailThreadIds"], ["18f0threadAAA"])
        self.assertEqual(
            deal["url"],
            "https://www.bizbuysell.com/business-opportunity/hvac/2214412",
        )

    def test_digest_shares_thread_across_deals(self) -> None:
        _seed_deal(
            self.con, ext_id="nl:digest:0", title="Deal one",
            url_norm="https://example.com/one", msg_id="digest-msg",
        )
        _seed_deal(
            self.con, ext_id="nl:digest:1", title="Deal two",
            url_norm="https://example.com/two", msg_id="digest-msg",
        )
        db.upsert_mail(
            self.con,
            gmail_id="digest-msg",
            thread_id="shared-thread",
            sender="helen@mail.smbdealhunter.xyz",
            subject="New Off-Market",
            received="2026-09-18",
            body="digest",
            label="listing",
        )
        self.con.commit()
        payload = exp.export(self.db_path)
        by_title = {d["title"]: d["gmailThreadIds"] for d in payload["deals"]}
        self.assertEqual(by_title["Deal one"], ["shared-thread"])
        self.assertEqual(by_title["Deal two"], ["shared-thread"])

    def test_null_thread_id_is_not_replaced_with_gmail_id(self) -> None:
        _seed_deal(
            self.con, ext_id="bbs:orphan:0", title="No thread",
            url_norm="https://example.com/orphan", msg_id="gmail-only",
        )
        db.upsert_mail(
            self.con,
            gmail_id="gmail-only",
            thread_id=None,
            sender="x@y.com",
            subject="s",
            received="2026-09-18",
            body="b",
            label="listing",
        )
        self.con.commit()
        deal = exp.export(self.db_path)["deals"][0]
        self.assertEqual(deal["gmailThreadIds"], [])
        self.assertNotIn("gmail-only", deal["gmailThreadIds"])

    def test_url_falls_back_to_deal_sources(self) -> None:
        _seed_deal(
            self.con, ext_id="bbs:src:0", title="Source url only",
            url_norm="", msg_id="msg-src",
            source_url="https://www.bizbuysell.com/business-opportunity/src/9",
        )
        self.con.commit()
        deal = exp.export(self.db_path)["deals"][0]
        self.assertEqual(
            deal["url"],
            "https://www.bizbuysell.com/business-opportunity/src/9",
        )


class SmbListingUrlTests(unittest.TestCase):
    def test_numbered_digest_keeps_app_url(self) -> None:
        body = """In Today's Issue

#1: [Hawaii Tour Operator with Contract-Backed Revenue and $763K SDE](https://app.smbdealhunter.xyz/item-detail?recordId=rectxcuPHqTYCa8q1)
#2: [Two Massage Franchise Locations with Managers and $621K SDE](https://app.smbdealhunter.xyz/item-detail?recordId=recSJ0uaDEF2gvNiP)
"""
        items = ing._numbered_digest_items(body)
        self.assertEqual(len(items), 2)
        self.assertIn("app.smbdealhunter.xyz/item-detail?recordId=rectxcuPHqTYCa8q1", items[0])
        lst = ing.extract(items[0], "newsletter", "msg1", 0, source="smbdealhunter.xyz")
        self.assertIn("recordId=rectxcuPHqTYCa8q1", lst.url)

    def test_does_not_invent_url_when_digest_has_none(self) -> None:
        body = """Latest Texas deal listings

Industrial Coatings Platform
Revenue: $4,200,000
EBITDA: $610,000
Dallas, TX
"""
        blocks = ing.split_newsletter(body, sender="lisa.lippe@generational.deals")
        self.assertTrue(blocks)
        lst = ing.extract(blocks[0], "generational", "msg2", 0, source="generational.deals")
        self.assertEqual(lst.url, "")


if __name__ == "__main__":
    unittest.main()
