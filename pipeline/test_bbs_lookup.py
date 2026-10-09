"""bbs_lookup requires a headline so the actor URL has a real slug."""
import unittest

import bbs_lookup
import enrich_bizbuysell as bbs


class ListingQueryTest(unittest.TestCase):
    def test_bare_id_is_rejected(self):
        with self.assertRaises(ValueError):
            bbs_lookup.listing_query("2483522")

    def test_id_and_headline(self):
        q, url, title = bbs_lookup.listing_query(
            "2483522 | Successful, Growing Landscape Company in North Texas!"
        )
        self.assertEqual(q, "2483522")
        self.assertIn("q=2483522", url)
        self.assertIn("Landscape", title)

    def test_slug_url(self):
        raw = (
            "https://www.bizbuysell.com/business-opportunity/"
            "thriving-water-and-fire-damage-restoration-company/2560996/"
        )
        q, url, title = bbs_lookup.listing_query(raw)
        self.assertEqual(q, "2560996")
        self.assertEqual(url, raw)
        self.assertEqual(title, "")

    def test_profile_url_needs_headline(self):
        raw = "https://www.bizbuysell.com/listings/Profile/?q=2483522"
        with self.assertRaises(ValueError):
            bbs_lookup.listing_query(raw)

    def test_split_queries(self):
        parts = bbs_lookup.split_queries(
            "2483522 | Landscape ;; 2562233 | Mortgage Broker"
        )
        self.assertEqual(len(parts), 2)

    def test_pairs(self):
        chunks = bbs.chunk_urls(["a", "b", "c", "d", "e"], 2)
        self.assertEqual(chunks, [["a", "b"], ["c", "d"], ["e"]])

    def test_category_is_not_a_state(self):
        self.assertIsNone(bbs.normalize_state("Banking and Loans"))
        self.assertEqual(bbs.normalize_state("Texas"), "TX")
        self.assertEqual(bbs.normalize_state("oh"), "OH")


if __name__ == "__main__":
    unittest.main()
