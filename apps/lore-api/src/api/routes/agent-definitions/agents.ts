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
import { checkApproval, type ApprovalOutcome } from "../two-key.js";
import type { Request } from "@hapi/hapi";
import type { PodResourcesWrite } from "@re-cinq/lore-shared/project/agents/agent-defs-port.js";

// Per-repo agent definitions API; `image` is two-key gated like dark_factory.execution.image (ADR-025).

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

/** The image-touch gate, and the ceremony it produced — `gate` is null when the write never touched the gated field. */
async function resolveCeremony(
  request: Request,
  repo: string,
  imageTouched: boolean,
): Promise<{ gate: ApprovalOutcome | null; ceremony: Ceremony }> {
  const gate = imageTouched
    ? await checkApproval(request, repo, ["image"], IMAGE_DETAIL)
    : null;

  const ceremony: Ceremony = gate?.ok
    ? {
        tier: "two_key",
        pr_ref: gate.evidence.prRef,
        approver: gate.evidence.approver,
      }
    : { tier: "admin" };

  return { gate, ceremony };
}

type AgentDefsFacade = Awaited<ReturnType<typeof projectFor>>["agentDefs"];

// config is whole-object across resolution layers — must carry the inherited (org → yaml) config or orphan its skills/command.
async function createFieldsWithPodResources(
  agentDefs: AgentDefsFacade,
  fields: Omit<ReturnType<typeof parseAgentInput>, "pod_resources">,
  podResources: ReturnType<typeof parseAgentInput>["pod_resources"],
): Promise<typeof fields> {
  if (!podResources) {
    return fields;
  }
  const inherited = await agentDefs.resolve(fields.name);

  return {
    ...fields,
    config: configWithPodResources(inherited?.config ?? null, podResources),
  };
}

// Merge happens inside the upsert (atomic under the row lock); resolved config is only the fallback so a fresh fork keeps inherited org/yaml keys.
async function resolvePodResourcesUpdate(
  agentDefs: AgentDefsFacade,
  name: string,
  podResources: ReturnType<typeof parseAgentPatch>["pod_resources"],
): Promise<PodResourcesWrite | undefined> {
  if (podResources === undefined) {
    return undefined;
  }

  return {
    podResources,
    inheritedConfig: (await agentDefs.resolve(name))?.config ?? null,
  };
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
        // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
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

        const { gate, ceremony } = await resolveCeremony(
          request,
          repo,
          imageFieldTouched(create),
        );

        if (gate && !gate.ok) {
          return h.response(gate.body).code(gate.code);
        }

        const { pod_resources, ...fields } = create;
        const finalFields = await createFieldsWithPodResources(
          project.agentDefs,
          fields,
          pod_resources,
        );

        const def = await project.agentDefs.create(finalFields);

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

        const { gate, ceremony } = await resolveCeremony(
          request,
          repo,
          imageFieldTouched(patch),
        );

        if (gate && !gate.ok) {
          return h.response(gate.body).code(gate.code);
        }

        const { pod_resources, ...fields } = patch;
        const podResources = await resolvePodResourcesUpdate(
          project.agentDefs,
          name,
          pod_resources,
        );

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
