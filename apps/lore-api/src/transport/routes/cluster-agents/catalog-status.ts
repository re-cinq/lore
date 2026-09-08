import type { CatalogApplyReport } from "@re-cinq/lore-shared/project/agents/catalog-status-port.js";
import { extractBearer } from "@re-cinq/lore-shared/http/bearer.js";
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
import type { CatalogStatusRepository } from "@re-cinq/lore-shared/project/agents/catalog-status-port.js";
import { PgCatalogStatus } from "@re-cinq/lore-shared/project/agents/catalog-status-pg.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";
import { authenticateClusterAgent } from "./cluster-agent-auth.js";

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

/** Validates the reported batch and stores it. An unparseable batch is a 400 AFTER authentication, so a bad body never tells an anonymous caller whether the agent id exists. */
async function recordReports(
  deps: CatalogStatusDeps,
  agentId: string,
  body: unknown,
): Promise<
  | { code: 200; body: z.infer<typeof StatusRecorded> }
  | { code: 400; body: { error: string } }
> {
  const parsed = ReportSchema.safeParse(body);

  if (!parsed.success) {
    return { code: 400, body: { error: "invalid report" } };
  }

  const { reports } = parsed.data;

  await deps.status.record(agentId, reports.map(toRecord));

  return { code: 200, body: { ok: true, recorded: reports.length } };
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
  const authorized = await authenticateClusterAgent(
    deps.agents,
    bearer,
    agentId,
  );

  if ("code" in authorized) {
    return authorized;
  }

  return recordReports(deps, authorized.agent.id, body);
}

/** A cluster-agent reporting what it applied. The cursor moves only on this report, so a failed apply is retried rather than skipped. */
async function serveCatalogStatus(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
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
    handler: withPool(getPool, serveCatalogStatus),
  };
}
