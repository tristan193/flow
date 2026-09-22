"""Axial/census region extract — not City, ST from paren codes.

  python test_extract_location.py
"""
from __future__ import annotations

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ingest as ing


WESTERN_MIDWEST = "Western Midwest (IA, KS, MO, NE, ND, SD)"
MIDDLE_ATLANTIC = "Middle Atlantic (CT, DE, DC, FL, GA, MD, NC, NJ, NY, PA, RI, SC, VA, VT)"
WEST_SOUTH_CENTRAL = "West South Central (AR, LA, OK, TX)"
MOUNTAIN = "Mountain (AZ, CO, ID, MT, NV, NM, UT, WY)"
MOUNTAIN_TRUNCATED = "Mountain (AZ, CO, …)"


class ExtractLocationRegionTests(unittest.TestCase):
    def test_paren_state_list_is_region_not_city_state(self):
        city, state, county, region = ing.extract_location(
            f"Geography: {WESTERN_MIDWEST}\nRevenue: $5.0M"
        )
        self.assertIsNone(city)
        self.assertIsNone(state)
        self.assertIsNone(county)
        self.assertEqual(region, WESTERN_MIDWEST)

    def test_middle_atlantic_is_not_dc_fl(self):
        city, state, county, region = ing.extract_location(
            f"Geography\n{MIDDLE_ATLANTIC}\nIndustries"
        )
        self.assertIsNone(city)
        self.assertIsNone(state)
        self.assertEqual(region, MIDDLE_ATLANTIC)

    def test_real_city_st_still_wins(self):
        city, state, county, region = ing.extract_location(
            "Established shop in Georgetown, TX with crews on the ground."
        )
        self.assertEqual(city, "Georgetown")
        self.assertEqual(state, "TX")
        self.assertIsNone(county)
        self.assertIsNone(region)

    def test_city_st_kept_when_region_also_present(self):
        city, state, county, region = ing.extract_location(
            f"Dallas, TX\nGeography: {WEST_SOUTH_CENTRAL}"
        )
        self.assertEqual(city, "Dallas")
        self.assertEqual(state, "TX")
        self.assertEqual(region, WEST_SOUTH_CENTRAL)

    def test_county_st_unchanged(self):
        city, state, county, region = ing.extract_location("Travis County, TX")
        self.assertIsNone(city)
        self.assertEqual(state, "TX")
        self.assertEqual(county, "Travis")
        self.assertIsNone(region)

    def test_extract_flags_region_as_location(self):
        lst = ing.extract(
            f"Regional Restoration\nBased on your criteria\nRevenue: $5.0M\n"
            f"EBITDA: $1.2M\n{WESTERN_MIDWEST}\n",
            "axial",
            "msg1",
            0,
            format_id="axial.single_deal",
        )
        self.assertEqual(lst.region, WESTERN_MIDWEST)
        self.assertIsNone(lst.city)
        self.assertIsNone(lst.state)
        self.assertNotIn("location", lst.needs_llm)


class RegionStatesTests(unittest.TestCase):
    def test_listed_states_and_tola(self):
        from geo import TOLA, states_of_region

        midwest = states_of_region(WESTERN_MIDWEST)
        self.assertTrue({"IA", "KS", "MO"} <= midwest)
        self.assertFalse(midwest & set(TOLA))

        wsc = states_of_region(WEST_SOUTH_CENTRAL)
        self.assertTrue({"AR", "LA", "OK", "TX"} <= wsc)
        self.assertTrue(wsc & set(TOLA))

        mountain = states_of_region(MOUNTAIN)
        self.assertIn("NM", mountain)
        truncated = states_of_region(MOUNTAIN_TRUNCATED)
        self.assertIn("NM", truncated)


class MisfileRecoverTests(unittest.TestCase):
    def test_ak_ca_is_pacific(self):
        from geo import recover_misfiled_region
        self.assertEqual(
            recover_misfiled_region("AK", "CA"),
            "Pacific (AK, CA, HI, OR, WA)",
        )

    def test_dc_fl_is_middle_atlantic_wrap(self):
        from geo import recover_misfiled_region
        self.assertIn("Middle Atlantic", recover_misfiled_region("DC", "FL") or "")

    def test_real_city_st_not_recovered(self):
        from geo import recover_misfiled_region
        self.assertIsNone(recover_misfiled_region("Georgetown", "TX"))

if __name__ == "__main__":
    unittest.main()


