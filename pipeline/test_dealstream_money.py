"""DealStream Search Genius — Cash Flow / Sales on separate lines.

  python test_dealstream_money.py
"""
from __future__ import annotations

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ingest as ing

# Shape from real mail gmail_id=1a0c4ebd7f8b6fa7 (Agricultural Supply, LA).
DEALSTREAM_SEARCH_GENIUS = """
DealStream

Personalized for Tristan Tully
Our AI-powered Search Genius found a listing we think you'll like.

Businesses For Sale
Agricultural Supply Business with Real Estate, LA (https://tracking.genius.dealstream.com/?ref=abc)

Louisiana - Other Agriculture - New Arrival - Real Estate Included - Management Will Stay

Asking Price

On Request

Cash Flow

$128,788

Sales

$2,094,078

A trusted provider of feed, seed, animal health products, and farm equipment
for decades, serving multiple South Louisiana parishes. Approximately $2 million
in consistent annual revenue, no debt, and a loyal multi-generational customer base.
"""


class DealStreamMoneyTests(unittest.TestCase):
    def test_cash_flow_and_sales_from_spaced_grid(self):
        money = ing.extract_money_fields(DEALSTREAM_SEARCH_GENIUS)
        self.assertEqual(money.get("sde"), 128788.0)
        self.assertEqual(money.get("revenue"), 2094078.0)
        self.assertNotIn("asking", money)  # "On Request" is not a figure

    def test_crlf_spacers_still_bind(self):
        body = (
            "Cash Flow\r\n \r\n \r\n $128,788\r\n"
            "Sales\r\n \r\n $2,094,078\r\n"
        )
        money = ing.extract_money_fields(body)
        self.assertEqual(money.get("sde"), 128788.0)
        self.assertEqual(money.get("revenue"), 2094078.0)


if __name__ == "__main__":
    unittest.main()
