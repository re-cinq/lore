import { audit, repoOf, CeremonySchema } from "./agent-common.js";
import {
  createAgentDefinition,
  updateAgentDefinition,
} from "./agent-writes.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { Pool } from "pg";
import { rethrowBoom, apiError } from "../../http/api-error.js";
import type { ResponseObject, ResponseToolkit, ServerRoute } from "@hapi/hapi";

import { ResolvedAgentDefinitionSchema } from "@re-cinq/lore-shared/models/agent-definition.js";
import { z } from "zod";
import { projectFor } from "../../../outbound/project-boot.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import type { Request } from "@hapi/hapi";

// Per-repo agent definitions API; `image` is two-key gated like dark_factory.execution.image (ADR-025).

const BASE = "/api/repos/{owner}/{repo}/agent-definitions";

/** GET answers with ONE definition when a name is given, the list when it is not. */
const AgentReadSchema = z.union([
  ResolvedAgentDefinitionSchema,
  z.object({ agents: z.array(ResolvedAgentDefinitionSchema) }),
]);

const AgentWrittenSchema = z.object({
  ok: z.literal(true),
  agent: ResolvedAgentDefinitionSchema,
  ceremony: CeremonySchema,
});

const AgentDeletedSchema = z.object({
  ok: z.literal(true),
  deleted: z.string(),
});

// config is whole-object across resolution layers — must carry the inherited (org → yaml) config or orphan its skills/command.

// Merge happens inside the upsert (atomic under the row lock); resolved config is only the fallback so a fresh fork keeps inherited org/yaml keys.

/** Reads the definitions in force for a repo: the per-repo row where there is one, else the org default, so a caller sees what would actually run. */
async function serveAgentsGet(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  enforceTrue(getPool(), apiError(503), "database unavailable");
  const name = request.params.name as string | undefined;

  try {
    const project = await projectFor(repoOf(request.params));

    if (name) {
      const def = await project.agentDefs.resolve(name);

      enforceTrue(def, apiError(404, { name }), "agent definition not found");

      return h.response(def);
    }

    return h.response({ agents: await project.agentDefs.list() });
  } catch (err) {
    // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
    rethrowBoom(err);

    console.error("[agents] route failed:", err);

    return h.response({ error: "internal" }).code(500);
  }
}

export function agentsGetRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: `${BASE}/{name?}`,
    options: zodResponse(bearerScope("read"), AgentReadSchema, {
      name: "AgentDefinitionRead",
      description: "One resolved agent definition, or the repo's list",
      errors: [404],
    }),
    handler: (request, h) => serveAgentsGet(getPool, request, h),
  };
}

export function agentsPostRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: BASE,
    options: zodResponse(bearerScope("admin"), AgentWrittenSchema, {
      name: "AgentDefinitionWritten",
      description: "The created definition, its ceremony, and the CRD outcome",
      errors: [400],
    }),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), "database unavailable");
      const repo = repoOf(request.params);

      try {
        const result = await createAgentDefinition(pool, request, repo);

        return h.response(result.body).code(result.code);
      } catch (err) {
        console.error("[agents] route failed:", err);

        return h.response({ error: "internal" }).code(500);
      }
    },
  };
}

export function agentsPutRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "PUT",
    path: `${BASE}/{name}`,
    options: zodResponse(bearerScope("admin"), AgentWrittenSchema, {
      name: "AgentDefinitionWritten",
      description: "The updated definition, its ceremony, and the CRD outcome",
      errors: [400],
    }),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), "database unavailable");
      const repo = repoOf(request.params);
      const name = request.params.name;

      try {
        const result = await updateAgentDefinition(pool, request, {
          repo,
          name,
        });

        return h.response(result.body).code(result.code);
      } catch (err) {
        console.error("[agents] route failed:", err);

        return h.response({ error: "internal" }).code(500);
      }
    },
  };
}

export function agentsDeleteRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "DELETE",
    path: `${BASE}/{name}`,
    options: zodResponse(bearerScope("admin"), AgentDeletedSchema, {
      name: "AgentDefinitionDeleted",
      description: "Which definition was removed, and the CRD outcome",
    }),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), "database unavailable");
      const repo = repoOf(request.params);
      const name = request.params.name;

      try {
        const project = await projectFor(repo);

        await project.agentDefs.delete(name);

        await audit(pool, repo, "agent_deleted", { name });

        return h.response({ ok: true, deleted: name });
      } catch (err) {
        console.error("[agents] route failed:", err);

        return h.response({ error: "internal" }).code(500);
      }
    },
  };
}
