/**
 * Rewrite Axial Pass URLs → Pursue in Neon.
 * Prefer: npx vercel env run --environment production -- node _fix_axial_pass_urls.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

function loadEnv(file) {
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function fixUrl(url) {
  return url
    .trim()
    .replace(/[).,;]+$/g, "")
    .replace(/action=decline/gi, "action=pursue")
    .replace(/utm_content=pass/gi, "utm_content=pursue");
}

function resolveDatabaseUrl() {
  const fromEnv = (process.env.DATABASE_URL || "").trim();
  if (fromEnv.startsWith("postgres")) return fromEnv;

  for (const name of [".env.neon.tmp", ".env.prod.pull", ".env.local"]) {
    const path = resolve(process.cwd(), name);
    if (!existsSync(path)) continue;
    const v = (loadEnv(path).DATABASE_URL || "").trim();
    if (v.startsWith("postgres")) return v;
  }
  return "";
}

const url = resolveDatabaseUrl();
if (!url) {
  console.error("DATABASE_URL not available. Run via:");
  console.error("  npx vercel env run --environment production -- node _fix_axial_pass_urls.mjs");
  process.exit(1);
}

console.log("connected, DATABASE_URL len=", url.length);

const sql = postgres(url, { max: 1, prepare: false, ssl: "require" });

const bad = await sql`
  SELECT id, title, url FROM deals
  WHERE url ILIKE '%axial%'
    AND (url ILIKE '%action=decline%' OR url ILIKE '%utm_content=pass%')
  ORDER BY id
`;
console.log("bad axial urls:", bad.length);
for (const row of bad) {
  const next = fixUrl(row.url);
  console.log(`#${row.id}`, (row.title || "").slice(0, 50));
  await sql`UPDATE deals SET url = ${next}, updated_at = now() WHERE id = ${row.id}`;
}

const [{ left }] = await sql`
  SELECT COUNT(*)::int AS left FROM deals
  WHERE url ILIKE '%axial%'
    AND (url ILIKE '%action=decline%' OR url ILIKE '%utm_content=pass%')
`;
const [{ good }] = await sql`
  SELECT COUNT(*)::int AS good FROM deals
  WHERE url ILIKE '%axial%' AND url ILIKE '%action=pursue%'
`;
console.log("remaining bad:", left, "· pursue urls:", good);
await sql.end();
