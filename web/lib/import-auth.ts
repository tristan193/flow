import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Shared bearer check for machine endpoints (/api/import, /api/import/flush).
 */
export function importTokenValid(header: string | null): boolean {
  const expected = process.env.FLOW_IMPORT_TOKEN?.trim();
  if (!expected) return false;

  const supplied = header?.replace(/^Bearer\s+/i, "").trim();
  if (!supplied) return false;

  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
