"""bbs_lookup accepts the ids Mailman already sees on a card."""
import unittest

import bbs_lookup


class ListingQueryTest(unittest.TestCase):
    def test_bare_id(self):
        q, url = bbs_lookup.listing_query("2483522")
        self.assertEqual(q, "2483522")
        self.assertEqual(url, "https://www.bizbuysell.com/listings/Profile/?q=2483522")

    def test_q_prefix(self):
        q, url = bbs_lookup.listing_query("q=2562233")
        self.assertEqual(q, "2562233")
        self.assertIn("q=2562233", url)

    def test_profile_url(self):
        raw = "https://www.bizbuysell.com/listings/Profile/?q=2483522&utm_source=email"
        q, url = bbs_lookup.listing_query(raw)
        self.assertEqual(q, "2483522")
        self.assertEqual(url, raw)

    def test_rejects_junk(self):
        with self.assertRaises(ValueError):
            bbs_lookup.listing_query("landscape company")


if __name__ == "__main__":
    unittest.main()
