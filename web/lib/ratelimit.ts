/**
 * Small in-process throttle for the login endpoint.
 *
 * A passcode is short enough to be worth guessing, and this is the only gate on
 * the app. State lives in memory, so on a horizontally scaled host the limit is
 * per instance rather than global — enough to make automated guessing slow, not
 * a substitute for a long passcode.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  bucket.count += 1;
  return bucket.count > MAX_ATTEMPTS;
}

export function clearAttempts(key: string): void {
  buckets.delete(key);
}
