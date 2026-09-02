import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { Pool } from "pg";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import type { ServerRoute } from "@hapi/hapi";

import { ResolvedAgentDefinitionSchema } from "@re-cinq/lore-shared/models/agent-definition.js";
import { z } from "zod";
import { projectFor } from "../../../platform/project-boot.js";
import {
  parseAgentInput,
  parseAgentPatch,
  imageFieldTouched,
  configWithPodResources,
} from "../../../features/agents/agents-schema.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { checkApproval } from "../two-key.js";

/**
 * Per-repo agent definitions API. GET resolves/lists (the RUNNER fetches the
 * resolved def here); POST/PUT/DELETE mutate the repo's project rows through
 * project.agentDefs — no SQL in the route. The `image` field is two-key gated
 * like dark_factory.execution.image (ADR-025). Scope: read for GET, admin for
 * writes (enforced per-route via bearerScope).
 */

const BASE = "/api/repos/{owner}/{repo}/agent-definitions";
const repoOf = (params: Record<string, string>) =>
  `${params.owner}/${params.repo}`;
/** The ceremony that authorised a write — `two_key` when the image was touched. */
const CeremonySchema = z.object({
  tier: z.enum(["two_key", "admin"]),
  pr_ref: z.string().optional(),
  approver: z.string().optional(),
});

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

const IMAGE_DETAIL =
  "Changing an agent's execution image requires an X-Lore-Approval-PR header. " +
  "Reference an open PR labeled `dark-factory-approval` by a CODEOWNER.";

type Ceremony = {
  tier: "two_key" | "admin";
  pr_ref?: string;
  approver?: string;
};

export function agentsGetRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: `${BASE}/{name?}`,
    options: zodResponse(bearerScope("read"), AgentReadSchema, {
      name: "AgentDefinitionRead",
      description: "One resolved agent definition, or the repo's list",
      errors: [404],
    }),
    handler: async (request, h) => {
      enforceTrue(getPool(), apiError(503), "database unavailable");
      const name = request.params.name as string | undefined;

      try {
        const project = await projectFor(repoOf(request.params));

        if (name) {
          const def = await project.agentDefs.resolve(name);

          enforceTrue(
            def,
            apiError(404, { name }),
            "agent definition not found",
          );

          return h.response(def);
        }

        return h.response({ agents: await project.agentDefs.list() });
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure
        // is this block's to shape.
        rethrowBoom(err);

        console.error("[agents] route failed:", err);

        return h.response({ error: "internal" }).code(500);
      }
    },
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
        const project = await projectFor(repo);

        const body = request.payload ?? {};
        let create: ReturnType<typeof parseAgentInput>;

        try {
          create = parseAgentInput(body);
        } catch (err) {
          return h
            .response({ error: "invalid_agent", issues: issuesOf(err) })
            .code(400);
        }

        let ceremony: Ceremony = { tier: "admin" };

        if (imageFieldTouched(create)) {
          const gate = await checkApproval(
            request,
            repo,
            ["image"],
            IMAGE_DETAIL,
          );

          if (!gate.ok) {
            return h.response(gate.body).code(gate.code);
          }
          ceremony = {
            tier: "two_key",
            pr_ref: gate.evidence.prRef,
            approver: gate.evidence.approver,
          };
        }

        const { pod_resources, ...fields } = create;

        if (pod_resources) {
          // config is whole-object across the resolution layers, so the new
          // row must carry the config it inherits (org → yaml) around the
          // block or it would orphan the skills/command the layer below sets.
          const inherited = await project.agentDefs.resolve(fields.name);

          fields.config = configWithPodResources(
            inherited?.config ?? null,
            pod_resources,
          );
        }

        const def = await project.agentDefs.create(fields);

        await audit(pool, repo, "agent_created", {
          name: def.name,
          ceremony,
        });

        return h.response({ ok: true, agent: def, ceremony });
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
        const project = await projectFor(repo);

        const body = request.payload ?? {};
        let patch: ReturnType<typeof parseAgentPatch>;

        try {
          patch = parseAgentPatch(body);
        } catch (err) {
          return h
            .response({ error: "invalid_agent", issues: issuesOf(err) })
            .code(400);
        }

        let ceremony: Ceremony = { tier: "admin" };

        if (imageFieldTouched(patch)) {
          const gate = await checkApproval(
            request,
            repo,
            ["image"],
            IMAGE_DETAIL,
          );

          if (!gate.ok) {
            return h.response(gate.body).code(gate.code);
          }
          ceremony = {
            tier: "two_key",
            pr_ref: gate.evidence.prRef,
            approver: gate.evidence.approver,
          };
        }

        const { pod_resources, ...fields } = patch;
        // The merge itself happens inside the upsert (atomic under the row
        // lock); the resolved config is only the fallback for a row that has
        // none of its own, so a fresh fork keeps the org/yaml keys it inherits.
        const podResources =
          pod_resources === undefined
            ? undefined
            : {
                podResources: pod_resources,
                inheritedConfig:
                  (await project.agentDefs.resolve(name))?.config ?? null,
              };

        const def = await project.agentDefs.update(name, fields, podResources);

        await audit(pool, repo, "agent_updated", {
          name,
          ceremony,
        });

        return h.response({ ok: true, agent: def, ceremony });
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

function issuesOf(err: unknown): unknown {
  return typeof err === "object" && err !== null && "issues" in err
    ? (err as { issues: unknown }).issues
    : (err as Error).message;
}

async function audit(
  pool: Pool,
  repo: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  await pool
    .query(
      `INSERT INTO pipeline.audit_log (event_type, repo, payload) VALUES ($1, $2, $3)`,
      [eventType, repo, JSON.stringify(payload)],
    )
    .catch(() => {
      // Audit log is best-effort; never block the write.
    });
}
