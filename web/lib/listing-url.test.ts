import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  listingOpenHref,
  normalizeAxialHref,
  normalizeListingHref,
  openListingUrl,
} from "./listing-url.ts";

const MATRIX =
  "https://network.axial.net/received-deals/new;id=a1b2c3d4e5f67890;tab=details;action=pursue";
const MATRIX_DECLINE =
  "https://network.axial.net/received-deals/new;id=a1b2c3d4e5f67890;tab=details;action=decline";
const QUERY =
  "https://network.axial.net/received-deals/new?id=a1b2c3d4e5f67890&tab=details&action=pursue&source=email";

test("Axial matrix Pursue URL stays intact after normalize and open href", () => {
  assert.equal(normalizeListingHref(MATRIX), MATRIX);
  assert.equal(normalizeAxialHref(MATRIX), MATRIX);

  const opened = listingOpenHref(MATRIX);
  assert.ok(opened);
  assert.equal(opened, MATRIX);
  assert.ok(opened.includes(";id=a1b2c3d4e5f67890"));
  assert.ok(opened.includes(";tab=details"));
  assert.ok(opened.includes(";action=pursue"));
  assert.equal(opened.includes("%3B"), false);
  assert.notEqual(opened.split(";")[0], opened);

  const parsed = new URL(opened);
  assert.ok(parsed.pathname.includes(";id=a1b2c3d4e5f67890"));
  assert.ok(parsed.href.includes(";action=pursue"));
});

test("matrix Pass params rewrite to Pursue without dropping ; segments", () => {
  assert.equal(normalizeListingHref(MATRIX_DECLINE), MATRIX);
  assert.equal(listingOpenHref(`  ${MATRIX_DECLINE}  `), MATRIX);
});

test("query-form Axial URL and wrapping punctuation stay usable", () => {
  assert.equal(normalizeListingHref(QUERY), QUERY);
  assert.equal(listingOpenHref(`(${MATRIX})`), MATRIX);
  assert.equal(normalizeListingHref("https://example.com/listing;"), "https://example.com/listing");
  assert.equal(
    normalizeListingHref("https://www.bizbuysell.com/business-opportunity/foo/123/"),
    "https://www.bizbuysell.com/business-opportunity/foo/123/",
  );
});

test("openListingUrl window.opens the full matrix string", () => {
  const opened: Array<[string, string, string]> = [];
  const original = globalThis.window;
  (globalThis as { window: { open: typeof window.open } }).window = {
    open: (url, target, features) => {
      opened.push([String(url), String(target), String(features)]);
      return null;
    },
  };

  try {
    const prevented: string[] = [];
    openListingUrl(MATRIX, {
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: () => prevented.push("prevent"),
      stopPropagation: () => prevented.push("stop"),
    });
    assert.deepEqual(prevented, ["prevent", "stop"]);
    assert.equal(opened.length, 1);
    assert.equal(opened[0]![0], MATRIX);
    assert.equal(opened[0]![1], "_blank");
  } finally {
    if (original === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      globalThis.window = original;
    }
  }
});

test("Original listing / playbook opens go through ListingLink", () => {
  const root = process.cwd();
  const files = [
    "components/deal-card.tsx",
    "components/next/deal-card.tsx",
    "components/next/review-client.tsx",
    "components/review-client.tsx",
    "app/deals/[id]/page.tsx",
    "app/next/deals/[id]/page.tsx",
    "components/pipeline-board.tsx",
    "components/action-deck.tsx",
  ];
  for (const file of files) {
    const src = readFileSync(path.join(root, file), "utf8");
    if (file === "components/action-deck.tsx") {
      assert.match(src, /listingOpenHref|openListingUrl/, `${file} should open via listing helper`);
      continue;
    }
    assert.match(src, /ListingLink/, `${file} should render ListingLink`);
    assert.doesNotMatch(
      src,
      /<a[^>]*href=\{(?:deal\.url|playbook\.href)\}/,
      `${file} must not put listing URLs on raw <a href>`,
    );
  }

  const helper = readFileSync(path.join(root, "lib/listing-url.ts"), "utf8");
  assert.match(helper, /encodeURI/);
  assert.doesNotMatch(helper, /\.split\(\s*["'];["']\s*\)/);
});
