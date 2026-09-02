import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { updateOrgDefinition } from "@re-cinq/lore-shared/project/agents/agent-defs-pg.js";
import { AgentDefsYaml } from "@re-cinq/lore-shared/project/agents/agent-defs-yaml.js";
import { ResolvedAgentDefinitionSchema } from "@re-cinq/lore-shared/models/agent-definition.js";
import { apiError, rethrowBoom } from "../../../server/api-error.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import {
  parseAgentPatch,
  imageFieldTouched,
} from "../../../features/agents/agents-schema.js";

/**
 * PUT /api/agent-definitions/{name} — the global /agents editor's write: upsert
 * the ORG-DEFAULT row (`project_id IS NULL`) every repo without an override
 * inherits. The catalog event the upsert appends is what fans the change out to
 * every cluster-agent's sync loop, so no direct CRD apply happens here.
 *
 * `image` is refused outright: the two-key image ceremony is CODEOWNERS-scoped
 * to a repo's CLAUDE.md, and no repo is in hand on the org surface — an org
 * image change goes through the per-repo route and its approval PR.
 */

const OrgAgentWrittenSchema = z.object({
  ok: z.literal(true),
  agent: ResolvedAgentDefinitionSchema,
});

const IMAGE_ORG_DETAIL =
  "Changing an execution image is CODEOWNERS-gated per repo. Set it through " +
  "/api/repos/{owner}/{repo}/agent-definitions with an approval PR instead.";

export function orgAgentDefinitionUpdateRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "PUT",
    path: "/api/agent-definitions/{name}",
    options: zodResponse(bearerScope("admin"), OrgAgentWrittenSchema, {
      name: "OrgAgentDefinitionWritten",
      description: "The updated org-default definition",
      errors: [400],
    }),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const name = request.params.name as string;

      try {
        let patch: ReturnType<typeof parseAgentPatch>;

        try {
          patch = parseAgentPatch(request.payload ?? {});
        } catch (err) {
          return h
            .response({ error: "invalid_agent", issues: issuesOf(err) })
            .code(400);
        }

        enforceTrue(
          !imageFieldTouched(patch),
          apiError(400, { detail: IMAGE_ORG_DETAIL }),
          "image_org_gated",
        );

        const { pod_resources, ...fields } = patch;
        // The merge happens inside the upsert, over the org row's own config
        // (atomic under the row lock — no read-then-write to lose a concurrent
        // edit to). The yaml layer is only the fallback for an org row that
        // has no config of its own, so it keeps the seed's skills around the
        // block instead of orphaning them. A body that never mentions
        // pod_resources leaves the row's config exactly as it was.
        const podResources =
          pod_resources === undefined
            ? undefined
            : {
                podResources: pod_resources,
                inheritedConfig:
                  (await new AgentDefsYaml().resolve("", name))?.config ?? null,
              };

        const agent = await updateOrgDefinition(
          pool,
          {
            name,
            model: fields.model ?? null,
            timeout_minutes: fields.timeout_minutes ?? null,
            prompt: fields.prompt ?? null,
            image: fields.image ?? null,
            execution_mode: fields.execution_mode ?? "claude-code",
            review_required: fields.review_required ?? false,
            config: fields.config ?? null,
          },
          podResources,
        );

        await audit(pool, "agent_org_updated", { name });

        return h.response({ ok: true, agent });
      } catch (err) {
        // A guard's refusal (the org image gate) already carries its status;
        // only an unexpected failure is this block's to shape.
        rethrowBoom(err);

        console.error("[agents] org update failed:", err);

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
  eventType: string,
  payload: unknown,
): Promise<void> {
  await pool
    .query(
      `INSERT INTO pipeline.audit_log (event_type, repo, payload) VALUES ($1, NULL, $2)`,
      [eventType, JSON.stringify(payload)],
    )
    .catch(() => {
      // Audit log is best-effort; never block the write.
    });
}
