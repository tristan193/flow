import { test } from "node:test";
import assert from "node:assert/strict";

import { assessFit, geographyOf } from "./fit.ts";
import { locationLabel } from "./model.ts";
import type { DealRow } from "./model.ts";

const HARVE_FOOTER = "Not restaurant/retail/ecommerce/SaaS.";

function deal(partial: Partial<DealRow> & { title: string }): DealRow {
  return {
    id: 1,
    ext_id: "fit-test",
    blurb: null,
    source: "harve.example",
    sub_source: null,
    nickname: "Harve",
    sources: null,
    city: null,
    state: "TX",
    county: null,
    region: null,
    revenue: null,
    ebitda: null,
    sde: null,
    asking: null,
    business_model_type: "LOCATION_AGNOSTIC",
    needs_llm: [],
    url: null,
    first_seen: "2026-09-01",
    last_seen: "2026-09-01",
    times_seen: 1,
    stage: "inbox",
    stage_changed_at: null,
    stage_changed_by: null,
    cim_url: null,
    nda_url: null,
    gmail_thread_url: null,
    earnings: null,
    earnings_basis: null,
    earnings_is_sde: false,
    margin: null,
    ...partial,
  };
}

test("Harve 'Not restaurant/retail/ecommerce/SaaS' footer does not exclude as restaurant", () => {
  const fit = assessFit(
    deal({
      title: "Commercial millwork shop",
      blurb: `Custom casework for hospitals. ${HARVE_FOOTER}`,
    }),
  );
  assert.notEqual(fit.disqualifier, "excluded category: restaurant");
  assert.notEqual(fit.disqualifier, "excluded category: software");
  assert.notEqual(fit.level, "out");
});

test("towing title plus Harve footer is not restaurant-out", () => {
  const fit = assessFit(
    deal({
      title: "Scalable Towing Company",
      blurb: `Fleet towing and roadside. ${HARVE_FOOTER}`,
    }),
  );
  assert.notEqual(fit.disqualifier, "excluded category: restaurant");
  assert.notEqual(fit.level, "out");
  assert.notEqual(fit.detail, "Excluded category · restaurant");
});

test("life-safety / logistics blurbs with the same footer stay in-box on category", () => {
  for (const title of [
    "Life-safety monitoring platform",
    "Regional logistics brokerage",
  ]) {
    const fit = assessFit(deal({ title, blurb: HARVE_FOOTER }));
    assert.notEqual(fit.level, "out", title);
    assert.equal(fit.disqualifier, null, title);
  }
});

test("actual restaurant or cafe in title/blurb is still excluded", () => {
  const cafe = assessFit(
    deal({ title: "Neighborhood Cafe", blurb: "Busy breakfast cafe near downtown." }),
  );
  assert.equal(cafe.level, "out");
  assert.equal(cafe.disqualifier, "excluded category: restaurant");
  assert.equal(cafe.detail, "Excluded category · restaurant");

  const restaurant = assessFit(
    deal({
      title: "Turnkey Italian restaurant",
      blurb: "Full-service restaurant with patio.",
    }),
  );
  assert.equal(restaurant.level, "out");
  assert.equal(restaurant.disqualifier, "excluded category: restaurant");
});

test("real restaurant still excludes even when the Harve footer is present", () => {
  const fit = assessFit(
    deal({
      title: "Waterfront seafood restaurant",
      blurb: `Owner retiring. ${HARVE_FOOTER}`,
    }),
  );
  assert.equal(fit.level, "out");
  assert.equal(fit.disqualifier, "excluded category: restaurant");
});

test("other clear negations of restaurant do not trip the chip", () => {
  const cases = [
    "Not a restaurant. Commercial HVAC.",
    "Non-restaurant towing and recovery.",
    "No restaurant component — millwork only.",
    "Clears restaurant/retail/ecommerce.",
  ];
  for (const blurb of cases) {
    const fit = assessFit(deal({ title: "Specialty millwork", blurb }));
    assert.notEqual(fit.level, "out", blurb);
    assert.notEqual(fit.disqualifier, "excluded category: restaurant", blurb);
  }
});

test("Axial Western Midwest region is viable G3, not a fake IA, KS city", () => {
  const row = deal({
    title: "Regional Restoration And Environmental Services Contractor",
    city: null,
    state: null,
    region: "Western Midwest (IA, KS, MO, NE, ND, SD)",
  });
  const geo = geographyOf(row);
  assert.equal(geo.tier, "G3");
  assert.equal(geo.label, "National");
  assert.equal(
    locationLabel(row),
    "Western Midwest (IA, KS, MO, NE, ND, SD)",
  );
  const fit = assessFit(row);
  assert.notEqual(fit.geoTier, null);
});

test("West South Central region lands in TOLA G2", () => {
  const geo = geographyOf(
    deal({
      title: "Industrial services platform",
      city: null,
      state: null,
      region: "West South Central (AR, LA, OK, TX)",
    }),
  );
  assert.equal(geo.tier, "G2");
  assert.equal(geo.label, "TOLA");
});

test("truncated Mountain region includes NM so it is G2", () => {
  const geo = geographyOf(
    deal({
      title: "Mountain-region contractor",
      city: null,
      state: null,
      region: "Mountain (AZ, CO, …)",
    }),
  );
  assert.equal(geo.tier, "G2");
  assert.equal(geo.label, "TOLA");
});

test("Middle Atlantic region is G3 National, not city=DC state=FL", () => {
  const row = deal({
    title: "Middle Atlantic services",
    city: null,
    state: null,
    region: "Middle Atlantic (CT, DE, DC, FL, GA, MD, NC, NJ, NY, PA, RI, SC, VA, VT)",
  });
  const geo = geographyOf(row);
  assert.equal(geo.tier, "G3");
  assert.equal(
    locationLabel(row),
    "Middle Atlantic (CT, DE, DC, FL, GA, MD, NC, NJ, NY, PA, RI, SC, VA, VT)",
  );
});

test("real City/ST is preferred over a region on the same deal", () => {
  const geo = geographyOf(
    deal({
      title: "Corridor HVAC",
      city: "Austin",
      state: "TX",
      region: "Pacific (AK, CA, HI, OR, WA)",
    }),
  );
  assert.equal(geo.tier, "G1");
  assert.equal(
    locationLabel({
      city: "Austin",
      state: "TX",
      region: "Pacific (AK, CA, HI, OR, WA)",
    }),
    "Austin, TX",
  );
});

test("misfiled two-letter city/state does not display as City, ST", () => {
  assert.equal(
    locationLabel({ city: "IA", state: "KS", region: "Western Midwest (IA, KS, MO, NE, ND, SD)" }),
    "Western Midwest (IA, KS, MO, NE, ND, SD)",
  );
});
