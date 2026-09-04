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

// Upserts the ORG-DEFAULT row (project_id IS NULL); `image` is refused here since the two-key ceremony is CODEOWNERS-scoped per repo.

const OrgAgentWrittenSchema = z.object({
  ok: z.literal(true),
  agent: ResolvedAgentDefinitionSchema,
});

const IMAGE_ORG_DETAIL =
  "Changing an execution image is CODEOWNERS-gated per repo. Set it through " +
  "/api/repos/{owner}/{repo}/agent-definitions with an approval PR instead.";

function orDefault<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback;
}

function orgDefinitionFields(
  name: string,
  fields: Omit<ReturnType<typeof parseAgentPatch>, "pod_resources">,
) {
  return {
    name,
    model: orDefault(fields.model, null),
    timeout_minutes: orDefault(fields.timeout_minutes, null),
    prompt: orDefault(fields.prompt, null),
    image: orDefault(fields.image, null),
    execution_mode: orDefault(fields.execution_mode, "claude-code" as const),
    review_required: orDefault(fields.review_required, false),
    config: orDefault(fields.config, null),
  };
}

// Merge happens inside the upsert (atomic under the row lock); yaml is only the fallback for a configless org row, so it never orphans the seed's skills.
async function resolveOrgPodResourcesUpdate(
  name: string,
  podResources: ReturnType<typeof parseAgentPatch>["pod_resources"],
) {
  if (podResources === undefined) {
    return undefined;
  }

  return {
    podResources,
    inheritedConfig:
      (await new AgentDefsYaml().resolve("", name))?.config ?? null,
  };
}

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
        const podResources = await resolveOrgPodResourcesUpdate(
          name,
          pod_resources,
        );

        const agent = await updateOrgDefinition(
          pool,
          orgDefinitionFields(name, fields),
          podResources,
        );

        await audit(pool, "agent_org_updated", { name });

        return h.response({ ok: true, agent });
      } catch (err) {
        // A guard's refusal (the org image gate) already carries its status; only an unexpected failure is this block's to shape.
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
