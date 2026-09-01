import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, readSession } from "./lib/session";

/**
 * Everything is private except the login screen and the machine endpoints.
 *
 * /api/import authenticates with a bearer token instead of a session, because
 * it is called by the Python pipeline rather than a browser. /api/cron is the
 * same idea for Vercel Cron, which checks CRON_SECRET inside the route.
 */
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/import",
  "/api/next/import", // Next/Dirk loop — does not write live `deals`
  "/api/next/merge",
  "/api/next/dirk",
  "/api/cron",
  "/api/crm/pursuit", // machine harvest token; /api/crm/attention stays session-gated
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const member = await readSession(request.cookies.get(SESSION_COOKIE)?.value);

  if (isPublic(pathname)) {
    // Signed-in members have no reason to see the login screen again.
    if (pathname === "/login" && member) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!member) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
