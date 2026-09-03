import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CATCHER_GMAIL,
  dirkMailHref,
  extractGmailThreadId,
  gmailAllHref,
  gmailCatcherSearchUrl,
  gmailCatcherThreadUrl,
  isDirkForcedGmailHref,
  normalizeGmailThreadUrl,
} from "./gmail-thread.ts";

const CANON = "https://mail.google.com/mail/?authuser=dirk%40tullyinvesting.com#all/18f0abc";

test("canonical thread URL forces dirk@ authuser and never uses /mail/u/0", () => {
  assert.equal(gmailCatcherThreadUrl("18f0abc"), CANON);
  assert.equal(gmailAllHref("18f0abc"), CANON);
  assert.equal(gmailAllHref(" 18f0abc "), CANON);
  assert.equal(CATCHER_GMAIL, "dirk@tullyinvesting.com");
  assert.equal(isDirkForcedGmailHref(CANON), true);
  assert.equal(CANON.includes("/mail/u/"), false);
  assert.match(CANON, /authuser=dirk%40tullyinvesting\.com/);
});

test("legacy u/0 and missing-authuser URLs rewrite to the canonical thread form", () => {
  assert.equal(
    normalizeGmailThreadUrl("https://mail.google.com/mail/u/0/#all/18f0abc"),
    CANON,
  );
  assert.equal(
    normalizeGmailThreadUrl("https://mail.google.com/mail/u/1/#all/18f0abc"),
    CANON,
  );
  assert.equal(normalizeGmailThreadUrl("https://mail.google.com/mail/#all/18f0abc"), CANON);
  assert.equal(
    normalizeGmailThreadUrl(
      "https://mail.google.com/mail/u/0/?authuser=dirk@tullyinvesting.com#all/18f0abc",
    ),
    CANON,
  );
  assert.equal(gmailAllHref("https://mail.google.com/mail/u/0/#all/18f0abc"), CANON);
});

test("AccountChooser with Email=dirk@ is acceptable; thread id still canonicalizes", () => {
  const chooser =
    "https://accounts.google.com/AccountChooser?Email=dirk%40tullyinvesting.com&continue=https://mail.google.com/mail/u/0/%23all/18f0abc";
  assert.equal(extractGmailThreadId(chooser), "18f0abc");
  assert.equal(normalizeGmailThreadUrl(chooser), CANON);
  assert.equal(
    isDirkForcedGmailHref(
      "https://accounts.google.com/AccountChooser?Email=dirk@tullyinvesting.com&continue=https://mail.google.com/mail/",
    ),
    true,
  );
});

test("search and inbox fallbacks also force dirk@", () => {
  const search = gmailCatcherSearchUrl("Project Cactus");
  const inbox = gmailCatcherSearchUrl("");
  assert.equal(isDirkForcedGmailHref(search), true);
  assert.equal(isDirkForcedGmailHref(inbox), true);
  assert.doesNotMatch(search, /\/mail\/u\/\d+/);
  assert.doesNotMatch(inbox, /\/mail\/u\/\d+/);
  assert.equal(dirkMailHref({ gmailThreadUrl: "https://mail.google.com/mail/u/0/#all/18f0abc" }), CANON);
  assert.equal(isDirkForcedGmailHref(dirkMailHref({ searchQuery: "Iron Bull" })), true);
});

test("empty / unknown values do not invent a u/0 link", () => {
  assert.equal(normalizeGmailThreadUrl(null), null);
  assert.equal(normalizeGmailThreadUrl(""), null);
  assert.equal(gmailCatcherThreadUrl(""), "");
  const other = normalizeGmailThreadUrl("https://example.com/thread");
  assert.equal(other, "https://example.com/thread");
  assert.equal(isDirkForcedGmailHref("https://mail.google.com/mail/u/0/#all/18f0abc"), false);
  assert.equal(isDirkForcedGmailHref("https://mail.google.com/mail/#all/18f0abc"), false);
});

test("UI and API emitters go through the shared helper and never emit mail/u/0", () => {
  const files = [
    "lib/next/identity.ts",
    "lib/next/dirk.ts",
    "lib/next/deals.ts",
    "lib/deals.ts",
    "lib/expectations.ts",
    "lib/crm-pursuit.ts",
    "components/next/pipeline-board.tsx",
    "app/next/deals/[id]/page.tsx",
    "components/pursuit-links.tsx",
    "components/attention-panel.tsx",
    "components/pipeline-board.tsx",
  ];
  for (const rel of files) {
    const src = readFileSync(path.join(process.cwd(), rel), "utf8");
    assert.doesNotMatch(src, /mail\.google\.com\/mail\/u\//, rel);
    assert.doesNotMatch(src, /`https:\/\/mail\.google\.com\/mail\/u\/0/, rel);
  }
  const pursuit = readFileSync(path.join(process.cwd(), "..", "pipeline", "crm_pursuit.py"), "utf8");
  assert.match(pursuit, /gmail_catcher_thread_url/);
  assert.match(pursuit, /authuser=/);
  assert.doesNotMatch(pursuit, /mail\.google\.com\/mail\/u\//);
  const identity = readFileSync(path.join(process.cwd(), "lib/next/identity.ts"), "utf8");
  assert.match(identity, /gmailAllHref/);
  assert.match(identity, /gmail-thread/);
  const dirk = readFileSync(path.join(process.cwd(), "lib/next/dirk.ts"), "utf8");
  assert.match(dirk, /gmailAllHref/);
  const nextBoard = readFileSync(
    path.join(process.cwd(), "components/next/pipeline-board.tsx"),
    "utf8",
  );
  assert.match(nextBoard, /gmailAllHref/);
});
