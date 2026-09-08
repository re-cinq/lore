import { audit, repoOf, CeremonySchema } from "./agent-common.js";
import {
  createAgentDefinition,
  updateAgentDefinition,
} from "./agent-writes.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { Pool } from "pg";
import { rethrowBoom, apiError } from "@re-cinq/lore-shared/http/api-error.js";
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

/** One resolved definition when a name is given, the repo's whole list when it is not. */
async function readAgentDefinitions(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const project = await projectFor(repoOf(request.params));
  const name = request.params.name as string | undefined;

  if (!name) {
    return h.response({ agents: await project.agentDefs.list() });
  }

  const def = await project.agentDefs.resolve(name);

  enforceTrue(def, apiError(404, { name }), "agent definition not found");

  return h.response(def);
}

/** Reads the definitions in force for a repo: the per-repo row where there is one, else the org default, so a caller sees what would actually run. */
async function serveAgentsGet(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  enforceTrue(getPool(), apiError(503), "database unavailable");

  try {
    return await readAgentDefinitions(request, h);
  } catch (err) {
    // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
    rethrowBoom(err);

    console.error("[agents] route failed:", err);

    return h.response({ error: "internal" }).code(500);
  }
}

/** The shared write shell: the database guard, the status the writer chose, and the one place an unexpected failure becomes a 500. */
async function serveWrite(
  getPool: () => Pool | null,
  h: ResponseToolkit,
  write: (pool: Pool) => Promise<{ code: number; body: object }>,
): Promise<ResponseObject> {
  const pool = getPool();

  enforceTrue(pool, apiError(503), "database unavailable");

  try {
    const result = await write(pool);

    return h.response(result.body).code(result.code);
  } catch (err) {
    console.error("[agents] route failed:", err);

    return h.response({ error: "internal" }).code(500);
  }
}

/** Removes the per-repo row, leaving the org default (or yaml) in force again. */
async function deleteAgentDefinition(
  pool: Pool,
  request: Request,
): Promise<{ code: number; body: object }> {
  const repo = repoOf(request.params);
  const name = request.params.name as string;
  const project = await projectFor(repo);

  await project.agentDefs.delete(name);

  await audit(pool, repo, "agent_deleted", { name });

  return { code: 200, body: { ok: true, deleted: name } };
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
    handler: (request, h) =>
      serveWrite(getPool, h, (pool) =>
        createAgentDefinition(pool, request, repoOf(request.params)),
      ),
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
    handler: (request, h) =>
      serveWrite(getPool, h, (pool) =>
        updateAgentDefinition(pool, request, {
          repo: repoOf(request.params),
          name: request.params.name,
        }),
      ),
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
    handler: (request, h) =>
      serveWrite(getPool, h, (pool) => deleteAgentDefinition(pool, request)),
  };
}
