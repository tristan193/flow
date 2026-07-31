import { NextResponse, type NextRequest } from "next/server";

import { memberForPasscode, passcodesConfigured } from "@/lib/auth";
import { clearAttempts, tooManyAttempts } from "@/lib/ratelimit";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  if (!passcodesConfigured()) {
    return NextResponse.json(
      { error: "No passcodes are configured on the server yet." },
      { status: 503 },
    );
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  if (tooManyAttempts(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a few minutes and try again." },
      { status: 429 },
    );
  }

  let passcode = "";
  try {
    const body = await request.json();
    passcode = typeof body?.passcode === "string" ? body.passcode : "";
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const member = memberForPasscode(passcode);
  if (!member) {
    // Deliberately vague: saying "wrong passcode for Tristan" would confirm which
    // passcodes exist.
    return NextResponse.json({ error: "That passcode was not recognised." }, { status: 401 });
  }

  clearAttempts(ip);

  const response = NextResponse.json({ ok: true, member });
  response.cookies.set(SESSION_COOKIE, await signSession(member), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
