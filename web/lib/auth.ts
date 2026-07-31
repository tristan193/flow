import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { MEMBERS, type MemberId } from "./model";
import { SESSION_COOKIE, readSession } from "./session";

/**
 * Each partner gets their own passcode rather than sharing one.
 *
 * A single shared passcode would make the app unable to tell the two reviewers
 * apart, and per-member attribution is the whole point of the verdict model —
 * disagreement is preserved, not averaged. One passcode each keeps the login as
 * simple as a shared secret while still identifying who is reviewing.
 */
function passcodeFor(member: MemberId): string | undefined {
  const raw =
    member === "tristan"
      ? process.env.FLOW_PASSCODE_TRISTAN
      : process.env.FLOW_PASSCODE_PARTNER;
  return raw?.trim() || undefined;
}

export function passcodesConfigured(): boolean {
  return MEMBERS.some((m) => passcodeFor(m.id));
}

/**
 * Compares via fixed-length digests so the comparison time reveals neither the
 * passcode's contents nor its length.
 */
function matches(candidate: string, expected: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Resolves a submitted passcode to the member it belongs to, or null. */
export function memberForPasscode(candidate: string): MemberId | null {
  const submitted = candidate.trim();
  if (!submitted) return null;

  let found: MemberId | null = null;
  // Every member is checked even after a match so that the work done does not
  // depend on which passcode was supplied.
  for (const member of MEMBERS) {
    const expected = passcodeFor(member.id);
    if (expected && matches(submitted, expected) && !found) {
      found = member.id;
    }
  }
  return found;
}

/** The signed-in member for the current request, or null when signed out. */
export async function currentMember(): Promise<MemberId | null> {
  const store = await cookies();
  return readSession(store.get(SESSION_COOKIE)?.value);
}

/**
 * For server code that cannot render anything useful without a member. Routes
 * are already gated by middleware, so reaching this throw means a bug rather
 * than an ordinary signed-out visitor.
 */
export async function requireMember(): Promise<MemberId> {
  const member = await currentMember();
  if (!member) throw new Error("Not signed in");
  return member;
}
