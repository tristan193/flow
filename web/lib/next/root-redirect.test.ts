import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

test("root path permanently redirects to /next; login and APIs stay reachable", () => {
  const config = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
  const page = readFileSync(path.join(process.cwd(), "app/page.tsx"), "utf8");
  const middleware = readFileSync(path.join(process.cwd(), "middleware.ts"), "utf8");

  assert.match(config, /source:\s*["']\/["']/);
  assert.match(config, /destination:\s*["']\/next["']/);
  assert.match(config, /permanent:\s*true/);

  assert.match(page, /permanentRedirect\(\s*["']\/next["']\s*\)/);
  assert.doesNotMatch(page, /listDeals|ReviewClient|requireMember/);

  assert.match(middleware, /pathname === ["']\/["']/);
  assert.match(middleware, /["']\/next["']/);
  assert.match(middleware, /308/);
  assert.match(middleware, /["']\/login["']/);
  assert.match(middleware, /["']\/api\/import["']/);
  assert.match(middleware, /["']\/api\/next\/import["']/);
});

test("classic /pipeline /deals /import permanently redirect onto dealbook views", () => {
  const config = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
  const middleware = readFileSync(path.join(process.cwd(), "middleware.ts"), "utf8");
  const nav = readFileSync(path.join(process.cwd(), "components/next/nav.tsx"), "utf8");

  assert.match(config, /source:\s*["']\/pipeline["']/);
  assert.match(config, /destination:\s*["']\/next\/pipeline["']/);
  assert.match(config, /source:\s*["']\/deals\/:path\*["']/);
  assert.match(config, /source:\s*["']\/import["']/);
  assert.match(config, /destination:\s*["']\/db["']/);

  assert.match(middleware, /pathname === ["']\/pipeline["']/);
  assert.match(middleware, /["']\/next\/pipeline["']/);
  assert.match(middleware, /pathname === ["']\/deals["']/);
  assert.match(middleware, /pathname === ["']\/import["']/);

  assert.match(nav, /label:\s*["']Review["']/);
  assert.match(nav, /label:\s*["']Pipeline["']/);
  assert.match(nav, /label:\s*["']DB["']/);
  assert.doesNotMatch(nav, /Classic/);
});
