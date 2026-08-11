/**
 * POST /api/assembly-lines/{id}/rerun — the fork-and-rerun trigger
 * (specs/fork-rerun-from-node; the run-detail "rerun from here" button proxies
 * here). Bearer-authenticated (LORE_INGEST_TOKEN via the ingest-token strategy);
 * the web-ui holds the token server-side and gates the human on session + repo
 * access, exactly like the review-start twin.
 *
 * The route is the caller the port's drift guard was designed around: it loads
 * the CURRENT builtin definition, hashes it, and passes the hash so
 * `resumeFrom` can refuse a fork across definition drift. Port refusals
 * (non-terminal source, unknown node, hash mismatch, NULL stored hash) are
 * state conflicts, not malformed requests — they surface as 409 with the
 * port's message.
 */

import Boom from "@hapi/boom";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { ResumeRefusedError } from "@re-cinq/lore-shared/project/assembly-lines/resume.js";
import {
  definitionHash,
  loadBuiltinAssemblyLines,
} from "@re-cinq/lore-assembly-lines";
import type { AssemblyLine } from "@re-cinq/lore-assembly-lines";
import type { ServerRoute } from "@hapi/hapi";
import { assemblyLines } from "../../../kernel/queues.js";
import { projectFor } from "../../../composition/project-boot.js";
import { writeAuditLog } from "../../../jobs/lib/audit.js";
import { rawBody, parseJsonBody } from "../raw-body.js";

interface RerunBody {
  node_id?: string;
  /** Who clicked — the proxy's session identity, recorded in the audit log. */
  actor?: string;
}

export function assemblyLineRerunRoute(
  load: () => Promise<Map<string, AssemblyLine>> = loadBuiltinAssemblyLines,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/assembly-lines/{id}/rerun",
    options: { auth: "ingest-token", payload: { parse: false } },
    handler: async (request, h) => {
      const body = parseJsonBody<RerunBody>(rawBody(request));
      const nodeId = body.node_id;

      enforceTrue(
        typeof nodeId === "string" && nodeId.length > 0,
        Boom.badRequest,
        "node_id is required",
      );

      const lineId = request.params.id as string;
      const row = await assemblyLines().getById(lineId);

      enforceTrue(row, Boom.notFound, `no assembly line ${lineId}`);

      const definitions = await load();
      const definition = definitions.get(row.definitionName);

      enforceTrue(
        definition,
        Boom.conflict,
        `"${row.definitionName}" is not a builtin assembly line — a single-CR run has no graph to replay`,
      );

      const project = await projectFor(row.repo);
      let started: string;

      try {
        started = await project.assemblyLines.start(row.definitionName, {
          resumeFrom: { lineId: row.id, nodeId },
          definitionHash: definitionHash(definition),
        });
      } catch (err) {
        // Only the rules' refusal maps to a 4xx with its message; anything else
        // (DB down, adapter bug) propagates as a sanitized 500 — reporting it
        // as "refused" would misclassify an outage and leak internals.
        if (err instanceof ResumeRefusedError) {
          throw Boom.conflict(err.message);
        }
        throw err;
      }

      // A fork spends budget and pushes to an existing branch — record who
      // pulled the trigger. Best-effort: losing the audit row must not orphan
      // the already-started line into an error response.
      try {
        await writeAuditLog({
          event_type: "assembly_line_rerun",
          repo: row.repo,
          actor: body.actor ?? null,
          payload: {
            assembly_line_id: started,
            resumed_from_line_id: row.id,
            resumed_from_node_id: nodeId,
          },
        });
      } catch (err) {
        console.warn(
          "[assembly-line-rerun] audit write failed:",
          (err as Error).message,
        );
      }

      return h.response({ started }).code(202);
    },
  };
}
