import type { Request, ResponseToolkit, ResponseObject } from "@hapi/hapi";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { NO_FLOOR_DETAIL } from "@re-cinq/lore-shared/project/agents/agent-defs-no-floor.js";
import { FloorAgentDefs } from "@re-cinq/lore-shared/project/agents/agent-defs-floor.js";
import { ResolvedAgentDefinitionSchema } from "@re-cinq/lore-shared/models/agent-definition.js";
import { apiError, rethrowBoom } from "@re-cinq/lore-shared/http/api-error.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import {
  parseAgentPatch,
  type AgentPatch,
  type PodResources,
} from "../../../work/agents/agents-schema.js";
import { patchPodResources } from "./agent-common.js";
import { withPool } from "../with-pool.js";
import { OkTrue } from "../../http/ok-schema.js";
import { floorDefinitions, type FloorDefinitions } from "./org-list.js";

// Writes the ORG DEFAULT, the floor definition's own settings (#3995), image included: admin scope is its gate org-wide; the two-key ceremony guards a repo's image.

const OrgAgentWrittenSchema = z.object({
  ok: OkTrue,
  agent: ResolvedAgentDefinitionSchema,
});

/** A required org field sent as null is a form field left empty, so the stored value stays. */
const REQUIRED_ORG_FIELDS: readonly string[] = [
  "prompt",
  "image",
  "timeout_minutes",
];

export function orgAgentDefinitionUpdateRoute(
  getPool: () => Pool | null,
  definitions: FloorDefinitions = floorDefinitions,
): ServerRoute {
  return {
    method: "PUT",
    path: "/api/agent-definitions/{name}",
    options: zodResponse(bearerScope("admin"), OrgAgentWrittenSchema, {
      name: "OrgAgentDefinitionWritten",
      description: "The updated org-default definition",
      errors: [400],
    }),
    handler: withPool(getPool, (pool, request, h) =>
      serveOrgUpdate({ pool, definitions }, request, h),
    ),
  };
}

/** The org-default write. Anything past the body parse is either a guard's own refusal (which already carries its status) or an unexpected failure. */
interface OrgWriteDeps {
  pool: Pool;
  definitions: FloorDefinitions;
}

async function serveOrgUpdate(
  deps: OrgWriteDeps,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const name = request.params.name as string;

  try {
    return await orgUpdateOutcome(deps, name, request, h);
  } catch (err) {
    // A guard's refusal (the org image gate) already carries its status; only an unexpected failure is this block's to shape.
    rethrowBoom(err);

    console.error("[agents] org update failed:", err);

    return h.response({ error: "internal" }).code(500);
  }
}

/** Parses the body and applies it. A malformed body is the CALLER's mistake and answers 400 with the parse issues, rather than reaching the route's catch. */
async function orgUpdateOutcome(
  deps: OrgWriteDeps,
  name: string,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  let patch: AgentPatch;

  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- hapi types omit it, but request.payload is genuinely null for an empty body.
    patch = parseAgentPatch(request.payload ?? {});
  } catch (err) {
    return h
      .response({ error: "invalid_agent", issues: issuesOf(err) })
      .code(400);
  }

  return h.response({
    ok: true,
    agent: await applyOrgPatch(deps, name, patch),
  });
}

function issuesOf(err: unknown): unknown {
  return typeof err === "object" && err !== null && "issues" in err
    ? (err as { issues: unknown }).issues
    : (err as Error).message;
}

async function applyOrgPatch(
  deps: OrgWriteDeps,
  name: string,
  patch: AgentPatch,
) {
  const agent = await writeOrgPatch(deps.definitions, name, patch);

  await audit(deps.pool, "agent_org_updated", { name });

  return agent;
}

/** Only the patched fields change on the floor; with no floor there is nowhere to write, so the write is refused. */
async function writeOrgPatch(
  definitions: FloorDefinitions,
  name: string,
  patch: AgentPatch,
) {
  const floor = definitions();

  enforceTrue(floor, apiError(503, { detail: NO_FLOOR_DETAIL }), "no_floor");
  const { pod_resources, ...fields } = patch;

  return new FloorAgentDefs(floor).updateOrg(
    name,
    withoutClearedRequired(fields),
    await orgPodResourcesWrite(floor, name, pod_resources),
  );
}

type FloorApi = NonNullable<ReturnType<FloorDefinitions>>;

/** Merged per key over the org default's stored pod resources; the org default inherits from nothing. */
async function orgPodResourcesWrite(
  floor: FloorApi,
  name: string,
  podResources: AgentPatch["pod_resources"],
) {
  if (podResources === undefined) {
    return undefined;
  }
  const stored = await storedPodResources(floor, name);

  return {
    podResources: patchPodResources(stored, podResources),
    inheritedConfig: null,
  };
}

async function storedPodResources(
  floor: FloorApi,
  name: string,
): Promise<PodResources | undefined> {
  const body = (await floor.get(name))?.body;
  const config = body?.settings.config;

  return config?.pod_resources as PodResources | undefined;
}

function withoutClearedRequired(
  fields: Omit<AgentPatch, "pod_resources">,
): Omit<AgentPatch, "pod_resources"> {
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([key, value]) => !(value === null && REQUIRED_ORG_FIELDS.includes(key)),
    ),
  );
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
