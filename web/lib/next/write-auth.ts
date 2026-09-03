import { importTokenValid } from "../import-auth";
import { isMemberId } from "./model";

/** Machine operator for token-driven /next writes (same as stage moves). */
export const NEXT_STAGE_ACTOR = "dirk";
/** Written CIM review. Never a Pursue/Pass/Hold verdict. */
export const NEXT_REVIEW_ACTOR = "simon";

export type WriteVia = "token" | "session";

export type ResolvedWriter =
  | { ok: true; actor: string; via: WriteVia; token: boolean }
  | { ok: false; error: string; status: number };

/**
 * Token (FLOW_IMPORT_TOKEN) or member session.
 * Token must not impersonate Tristan/Jim — that would seed a determination.
 */
export function resolveNextWriter(input: {
  authorization: string | null;
  sessionMember: string | null;
  actor?: string | null;
  /** Token notes default to Simon. Stage / CIM-link default to Dirk. */
  tokenDefaultActor?: string;
}): ResolvedWriter {
  const token = importTokenValid(input.authorization);
  if (token) {
    const posted = input.actor?.trim().toLowerCase() || "";
    if (isMemberId(posted)) {
      return {
        ok: false,
        error: "Token cannot seed a Tristan or Jim determination. Use actor=simon for a review.",
        status: 400,
      };
    }
    const actor = posted || input.tokenDefaultActor || NEXT_STAGE_ACTOR;
    if (actor !== NEXT_STAGE_ACTOR && actor !== NEXT_REVIEW_ACTOR) {
      return { ok: false, error: "Token actor must be simon (review) or dirk.", status: 400 };
    }
    return { ok: true, actor, via: "token", token: true };
  }
  if (input.sessionMember) {
    return { ok: true, actor: input.sessionMember, via: "session", token: false };
  }
  return { ok: false, error: "Unauthorized.", status: 401 };
}
