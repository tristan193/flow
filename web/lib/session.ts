import { SignJWT, jwtVerify } from "jose";

import { isMemberId, type MemberId } from "./model";

export const SESSION_COOKIE = "flow_session";

/**
 * Sessions last a long time on purpose. This is a two-person tool used mostly
 * from phones; being logged out mid-week is a much bigger cost here than the
 * marginal risk, and signing out is always available.
 */
const SESSION_DAYS = 90;
export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

function secret(): Uint8Array {
  const value = process.env.FLOW_SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "FLOW_SESSION_SECRET must be set to a random string of at least 32 characters.",
    );
  }
  return new TextEncoder().encode(value);
}

export async function signSession(member: MemberId): Promise<string> {
  return new SignJWT({ member })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

/** Returns the member id if the token is valid, otherwise null. */
export async function readSession(token: string | undefined): Promise<MemberId | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return isMemberId(payload.member) ? payload.member : null;
  } catch {
    return null;
  }
}
