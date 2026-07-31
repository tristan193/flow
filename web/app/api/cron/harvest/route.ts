import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

/**
 * Clock for the deal harvest.
 *
 * The harvest itself runs on GitHub Actions (it needs the Python pipeline), but
 * GitHub's own `schedule:` trigger never fired for this repo — scheduled runs are
 * best-effort and are routinely dropped, which left the pipeline dependent on
 * somebody clicking "Run workflow". This endpoint is the reliable clock: Vercel
 * Cron calls it, and it dispatches the workflow through the same API the manual
 * button uses.
 *
 * Vercel Cron sends GET with `Authorization: Bearer $CRON_SECRET`. POST is
 * accepted too so any other scheduler (or curl) can drive the same path.
 */

const DEFAULT_REPO = "tristan193/flow";
const DEFAULT_WORKFLOW = "daily-harvest.yml";
const DEFAULT_REF = "main";

function secretValid(header: string | null): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;

  const supplied = header?.replace(/^Bearer\s+/i, "").trim();
  if (!supplied) return false;

  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

async function dispatchHarvest() {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set on this deployment." },
      { status: 500 },
    );
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_DISPATCH_TOKEN is not set on this deployment." },
      { status: 500 },
    );
  }

  const repo = process.env.GITHUB_REPO?.trim() || DEFAULT_REPO;
  const workflow = process.env.GITHUB_WORKFLOW_FILE?.trim() || DEFAULT_WORKFLOW;
  const ref = process.env.GITHUB_REF_NAME?.trim() || DEFAULT_REF;
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "flow-cron",
    },
    body: JSON.stringify({ ref }),
  });

  // GitHub answers 204 with an empty body on success.
  if (response.status === 204) {
    return NextResponse.json({ ok: true, dispatched: { repo, workflow, ref } });
  }

  const detail = await response.text().catch(() => "");
  return NextResponse.json(
    { ok: false, status: response.status, detail: detail.slice(0, 500) },
    { status: 502 },
  );
}

export async function GET(request: NextRequest) {
  if (!secretValid(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return dispatchHarvest();
}

export async function POST(request: NextRequest) {
  if (!secretValid(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return dispatchHarvest();
}
