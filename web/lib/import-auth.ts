import { pipelineTokenValid } from "./actors";

/**
 * Legacy harvest-lane bearer check (/api/import, /api/crm/pursuit): accepts
 * PIPELINE_TOKEN or the legacy FLOW_IMPORT_TOKEN. Agent tokens are rejected —
 * agents go through /api/next/* where resolveMachineActor() records who they
 * are in deal_log. /api/import/flush uses adminTokenValid (see lib/actors.ts).
 */
export function importTokenValid(header: string | null): boolean {
  return pipelineTokenValid(header);
}
