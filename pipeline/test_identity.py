"""Identity matching smoke path — same deal, two threads / CIM rename / missing name."""
from __future__ import annotations

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import identity as ident


class DealNumbers(unittest.TestCase):
    def test_format_and_parse(self):
        self.assertEqual(ident.format_deal_number(1), "TLY-001")
        self.assertEqual(ident.format_deal_number(42), "TLY-042")
        self.assertEqual(ident.format_deal_number(1000), "TLY-1000")
        self.assertEqual(ident.parse_deal_number("tly-001"), 1)
        self.assertEqual(ident.parse_deal_number("TLY-042"), 42)
        self.assertIsNone(ident.parse_deal_number("BBS-99"))


class SourceIds(unittest.TestCase):
    def test_axial_hex_from_pursue_html_not_subject(self):
        html = """
        <a href="https://network.axial.net/app/opportunity/a1b2c3d4e5f67890?action=decline">Pass</a>
        <a href="https://network.axial.net/app/opportunity/a1b2c3d4e5f67890?action=pursue">Pursue</a>
        """
        ids = ident.extract_source_ids(
            html=html,
            subject="Regional Restoration And Environmental Services Contractor",
        )
        self.assertEqual([s["canonical"] for s in ids], ["axial:a1b2c3d4e5f67890"])

    def test_axial_never_uses_subject_as_id(self):
        ids = ident.extract_source_ids(subject="a1b2c3d4e5f67890 looks like hex")
        self.assertEqual(ids, [])

    def test_bbs_q_param(self):
        url = "https://www.bizbuysell.com/business-opportunity/Profile/?q=2214412&utm_source=alert"
        ids = ident.extract_source_ids(url=url)
        self.assertEqual(ids[0]["canonical"], "bbs:2214412")

    def test_vaid_six_digit_subject(self):
        ids = ident.extract_source_ids(subject="New deal V-AID 847291 — HVAC", source="vaid.com")
        self.assertEqual(ids[0]["canonical"], "vaid:847291")

    def test_transworld(self):
        ids = ident.extract_source_ids(subject="Listing 1234-567890 now available")
        self.assertEqual(ids[0]["canonical"], "tw:1234-567890")


class Fingerprint(unittest.TestCase):
    def test_complete_fingerprint(self):
        fp, ok = ident.compute_fingerprint(
            title="Acme Filtration LLC",
            broker_firm="Benchmark International",
            ebitda=505_000,
            state="TX",
            city="Georgetown",
        )
        self.assertTrue(ok)
        self.assertEqual(fp, "acme filtration|benchmark|500000|georgetown|TX")

    def test_incomplete_without_broker(self):
        fp, ok = ident.compute_fingerprint(
            title="Acme Filtration",
            ebitda=500_000,
            state="TX",
        )
        self.assertFalse(ok)
        self.assertIsNone(fp)


class Matching(unittest.TestCase):
    def test_same_deal_two_threads_via_source_id(self):
        first = {
            "id": 1,
            "deal_number": "TLY-001",
            "source_deal_id": "bbs:2214412",
            "source_ids": [{"kind": "bbs", "value": "2214412", "canonical": "bbs:2214412"}],
            "title": "Established HVAC & Plumbing",
            "state": "TX",
        }
        incoming = {
            "title": "HVAC follow-up financials",
            "url": "https://www.bizbuysell.com/Business-Opportunity/hvac/?q=2214412",
            "gmail_thread_ids": ["threadBBB"],
        }
        hit = ident.find_identity_match(incoming, [first])
        self.assertIsNotNone(hit)
        self.assertEqual(hit[1], "source_id")
        self.assertEqual(hit[0]["deal_number"], "TLY-001")

    def test_cim_rename_keeps_alias(self):
        stored = {
            "id": 2,
            "deal_number": "TLY-014",
            "source_deal_id": "axial:deadbeefcafebabe",
            "source_ids": [{"kind": "axial", "value": "deadbeefcafebabe", "canonical": "axial:deadbeefcafebabe"}],
            "title": "Regional Restoration Teaser Name",
            "alias_names": ["Regional Restoration Teaser Name"],
        }
        incoming = {
            "title": "Confidential Information Memorandum — Apex Restoration",
            "html": '<a href="https://network.axial.net/app/opportunity/deadbeefcafebabe?action=pursue">Pursue</a>',
        }
        hit = ident.find_identity_match(incoming, [stored])
        self.assertEqual(hit[1], "source_id")
        aliases = ident.merge_alias_names(
            stored["alias_names"], incoming["title"], stored["title"]
        )
        self.assertIn("Regional Restoration Teaser Name", aliases)
        self.assertTrue(any("apex restoration" in a.lower() for a in aliases))

    def test_missing_company_name_still_joins_on_source_id(self):
        stored = {
            "id": 3,
            "deal_number": "TLY-003",
            "source_deal_id": "vaid:111222",
            "source_ids": [{"kind": "vaid", "value": "111222", "canonical": "vaid:111222"}],
            "title": "(untitled listing)",
        }
        incoming = {
            "title": "",
            "subject": "V-AID 111222",
            "source": "vaid.com",
        }
        hit = ident.find_identity_match(incoming, [stored])
        self.assertEqual(hit[1], "source_id")

    def test_never_match_broker_alone(self):
        stored = {
            "id": 4,
            "deal_number": "TLY-004",
            "title": "Water Treatment Platform",
            "broker_firm": "Benchmark International",
            "state": "TX",
            "ebitda": 800_000,
        }
        incoming = {
            "title": "Unrelated Roofing Outfit",
            "broker_firm": "Benchmark International",
            "state": "OK",
            "ebitda": 200_000,
        }
        self.assertIsNone(ident.find_identity_match(incoming, [stored]))

    def test_fingerprint_joins_when_no_source_id(self):
        fp, ok = ident.compute_fingerprint(
            title="Filter Media Co",
            broker_firm="Transworld",
            ebitda=410_000,
            state="TX",
            city="Austin",
        )
        self.assertTrue(ok)
        stored = {
            "id": 5,
            "deal_number": "TLY-005",
            "fingerprint": fp,
            "title": "Filter Media Co",
            "broker_firm": "Transworld",
            "state": "TX",
            "city": "Austin",
        }
        incoming = {
            "title": "Filter Media Company, LLC",
            "broker_firm": "Transworld Business Advisors",
            "ebitda": 412_000,
            "state": "TX",
            "city": "Austin",
        }
        hit = ident.find_identity_match(incoming, [stored])
        self.assertEqual(hit[1], "fingerprint")

    def test_action_summary_is_not_a_deal(self):
        self.assertTrue(
            ident.is_non_deal_mail(
                subject="Action Summary for Tristan",
                sender="notifications@axial.net",
                format_id="axial.action_summary",
            )
        )


class Threads(unittest.TestCase):
    def test_threads_accumulate_not_replace(self):
        merged = ident.merge_thread_ids(["aaa"], ["bbb", "aaa"])
        self.assertEqual(merged, ["aaa", "bbb"])

    def test_gmail_href(self):
        self.assertEqual(
            ident.gmail_all_href("18f0abc"),
            "https://mail.google.com/mail/u/0/#all/18f0abc",
        )


if __name__ == "__main__":
    unittest.main()
