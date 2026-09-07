import type { CatalogApplyReport } from "@re-cinq/lore-shared/project/agents/catalog-status-port.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { extractBearer } from "@re-cinq/lore-shared/http/bearer.js";
import { apiError } from "../../http/api-error.js";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import type { ClusterAgentsRepository } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-port.js";
import { PgClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-pg.js";
import { hashAgentToken } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agent-token.js";
import type { CatalogStatusRepository } from "@re-cinq/lore-shared/project/agents/catalog-status-port.js";
import { PgCatalogStatus } from "@re-cinq/lore-shared/project/agents/catalog-status-pg.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

// A cluster-agent reports what it DID with entries it read (applied/refused/skipped/deleted) — previously lived only in pod stdout and died with it (a 2026-09-01 refusal went 2h unrecorded). Reported SEPARATELY from the (GET) ack so a report failure costs visibility, never delivery.

const ReportSchema = z.object({
  reports: z
    .array(
      z.object({
        name: z.string().min(1),
        project_id: z.string().nullable(),
        state: z.enum(["applied", "refused", "skipped", "deleted"]),
        reason: z.string().nullable(),
      }),
    )
    .max(2000),
});

const StatusRecorded = z.object({ ok: z.literal(true), recorded: z.number() });

export interface CatalogStatusDeps {
  agents: ClusterAgentsRepository;
  status: CatalogStatusRepository;
}

/** The handler core, injectable for tests: authenticate, then record. */
/** The agent behind the bearer, or the refusal. The id in the path must match the token's own agent — a valid token for a DIFFERENT agent is a 403, not a 401, because the caller is authenticated and simply not this agent. */
async function authorizeAgent(
  deps: CatalogStatusDeps,
  bearer: string | undefined,
  agentId: string,
): Promise<
  | {
      agent: NonNullable<
        Awaited<ReturnType<CatalogStatusDeps["agents"]["findByTokenHash"]>>
      >;
    }
  | { code: 401 | 403; body: { error: string } }
> {
  if (!bearer) {
    return { code: 401, body: { error: "unauthorized" } };
  }
  const agent = await deps.agents.findByTokenHash(hashAgentToken(bearer));

  return !agent || agent.id !== agentId
    ? { code: 403, body: { error: "forbidden" } }
    : { agent };
}

/** One reported catalog entry, in the store's own spelling. `reason` rides along even for a success: a recipe that applied with a warning is what makes a later failure legible. */
function toRecord(
  r: z.infer<typeof ReportSchema>["reports"][number],
): CatalogApplyReport {
  return {
    name: r.name,
    projectId: r.project_id,
    state: r.state,
    reason: r.reason,
  };
}

export async function handleCatalogStatus(
  deps: CatalogStatusDeps,
  bearer: string | undefined,
  agentId: string,
  body: unknown,
): Promise<
  | { code: 200; body: z.infer<typeof StatusRecorded> }
  | { code: 400 | 401 | 403; body: { error: string } }
> {
  const agent = await authorizeAgent(deps, bearer, agentId);

  if ("code" in agent) {
    return agent;
  }
  const parsed = ReportSchema.safeParse(body);

  if (!parsed.success) {
    return { code: 400, body: { error: "invalid report" } };
  }

  await deps.status.record(agent.agent.id, parsed.data.reports.map(toRecord));

  return {
    code: 200,
    body: { ok: true, recorded: parsed.data.reports.length },
  };
}

/** A cluster-agent reporting what it applied. The cursor moves only on this report, so a failed apply is retried rather than skipped. */
async function serveCatalogStatus(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();

  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

  const result = await handleCatalogStatus(
    {
      agents: new PgClusterAgents(pool),
      status: new PgCatalogStatus(pool),
    },
    extractBearer(request.headers.authorization),
    request.params.id,
    request.payload,
  );

  return h.response(result.body).code(result.code);
}

export function clusterAgentCatalogStatusRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/cluster-agents/{id}/catalog-status",
    options: zodResponse(
      { auth: false, validate: { payload: zodValidate(ReportSchema) } },
      StatusRecorded,
      {
        name: "ClusterAgentCatalogStatus",
        description:
          "Record what this cluster did with each catalog entry it read — applied, refused (with the reason), skipped or deleted",
      },
    ),
    handler: (request, h) => serveCatalogStatus(getPool, request, h),
  };
}
