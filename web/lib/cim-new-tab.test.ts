import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "path";

import { isUnmodifiedPrimaryClick, openCimInNewTab } from "./cim-new-tab.ts";

function click(
  partial: Partial<{
    defaultPrevented: boolean;
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  }> = {},
) {
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...partial,
  };
}

test("unmodified primary click is forced into a new tab", () => {
  assert.equal(isUnmodifiedPrimaryClick(click()), true);
  assert.equal(isUnmodifiedPrimaryClick(click({ defaultPrevented: true })), false);
  assert.equal(isUnmodifiedPrimaryClick(click({ button: 1 })), false);
  assert.equal(isUnmodifiedPrimaryClick(click({ metaKey: true })), false);
  assert.equal(isUnmodifiedPrimaryClick(click({ ctrlKey: true })), false);
});

test("openCimInNewTab preventDefaults and window.opens; modifier clicks pass through", () => {
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
    openCimInNewTab("/cim/TLY-092", {
      ...click(),
      preventDefault: () => prevented.push("prevent"),
      stopPropagation: () => prevented.push("stop"),
    });
    assert.deepEqual(prevented, ["prevent", "stop"]);
    assert.deepEqual(opened, [["/cim/TLY-092", "_blank", "noopener,noreferrer"]]);

    opened.length = 0;
    openCimInNewTab("/cim/TLY-092", {
      ...click({ metaKey: true }),
      preventDefault: () => prevented.push("bad"),
      stopPropagation: () => prevented.push("bad"),
    });
    assert.deepEqual(opened, []);
    assert.equal(prevented.includes("bad"), false);
  } finally {
    if (original === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      globalThis.window = original;
    }
  }
});

test("every View CIM / cim_url control uses CimNewTabLink", () => {
  const root = process.cwd();
  const files = [
    "components/next/cim-review-client.tsx",
    "components/next/attach-cim.tsx",
    "components/next/deal-card.tsx",
    "components/attach-cim.tsx",
    "components/action-deck.tsx",
  ];
  for (const file of files) {
    const src = readFileSync(path.join(root, file), "utf8");
    assert.match(src, /CimNewTabLink/, `${file} should render CimNewTabLink`);
    assert.doesNotMatch(
      src,
      /<Link[^>]*(?:View CIM|cim_url|packHref|openUrl)/,
      `${file} must not wrap a CIM URL in Next.js Link`,
    );
  }

  const review = readFileSync(path.join(root, "components/next/cim-review-client.tsx"), "utf8");
  assert.match(review, /View CIM/);
  assert.match(review, /cimPackPath/);
  assert.doesNotMatch(review, /<Link[^>]*href=\{packHref\}/);

  const opener = readFileSync(path.join(root, "components/cim-new-tab-link.tsx"), "utf8");
  assert.match(opener, /target="_blank"/);
  assert.match(opener, /rel=\{CIM_NEW_TAB_REL\}/);
  assert.match(opener, /openCimInNewTab/);
  assert.match(opener, /window\.open|_blank/);

  const helper = readFileSync(path.join(root, "lib/cim-new-tab.ts"), "utf8");
  assert.match(helper, /window\.open\(url, "_blank", CIM_NEW_TAB_FEATURES\)/);
  assert.match(helper, /preventDefault/);
});
