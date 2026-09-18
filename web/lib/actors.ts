import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Machine identities. Every agent/pipeline caller gets its own bearer token so
 * deal_log.actor is always the credential that made the call:
 *
 *   DIRK_TOKEN      → dirk    (pursuit operator agent)
 *   SIMON_TOKEN     → simon   (CIM intake agent)
 *   PIPELINE_TOKEN  → pipeline (GitHub Actions harvest)
 *   FLOW_IMPORT_TOKEN → dirk  (legacy shared token; kept working during the
 *                              transition, attributed to dirk as before)
 *
 * Humans (tristan / partner) authenticate by session, never by token.
 */

export type MachineActor = "dirk" | "simon" | "pipeline";

const TOKEN_ENVS: Array<{ env: string; actor: MachineActor }> = [
  { env: "DIRK_TOKEN", actor: "dirk" },
  { env: "SIMON_TOKEN", actor: "simon" },
  { env: "PIPELINE_TOKEN", actor: "pipeline" },
  { env: "FLOW_IMPORT_TOKEN", actor: "dirk" },
];

function tokenMatches(supplied: string, expected: string): boolean {
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function matchEnv(header: string | null, envs: string[]): string | null {
  const supplied = header?.replace(/^Bearer\s+/i, "").trim();
  if (!supplied) return null;
  for (const env of envs) {
    const expected = process.env[env]?.trim();
    if (expected && tokenMatches(supplied, expected)) return env;
  }
  return null;
}

/** Bearer header → machine actor handle, or null when the token is invalid. */
export function resolveMachineActor(header: string | null): MachineActor | null {
  const env = matchEnv(header, TOKEN_ENVS.map((t) => t.env));
  return TOKEN_ENVS.find((t) => t.env === env)?.actor ?? null;
}

/**
 * Harvest-lane check (/api/import, /api/crm/pursuit): the pipeline token or
 * the legacy shared token. Agent tokens (Dirk/Simon) are not accepted here.
 */
export function pipelineTokenValid(header: string | null): boolean {
  return matchEnv(header, ["PIPELINE_TOKEN", "FLOW_IMPORT_TOKEN"]) !== null;
}

/**
 * Destructive-op check (/api/import/flush): the legacy shared token only.
 * Per-agent tokens can never flush or purge.
 */
export function adminTokenValid(header: string | null): boolean {
  return matchEnv(header, ["FLOW_IMPORT_TOKEN"]) !== null;
}
