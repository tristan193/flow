import { test } from "node:test";
import assert from "node:assert/strict";

import { assessFit } from "./fit.ts";
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
