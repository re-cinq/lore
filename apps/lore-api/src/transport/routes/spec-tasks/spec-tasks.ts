import { zodResponse } from "../../http/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import {
  parseTasks,
  syncTasksToDb,
  getReadyTasks,
  claimTask,
  completeTask,
} from "@re-cinq/lore-server-core/features/pipeline/tasks.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { repoFullName } from "../common-schemas.js";
import { withPool } from "../with-pool.js";

// Spec-task DAG (sync→ready→claim→complete) over HTTP for the MCP tools — local adapter holds no pool (ADR-032), so queue mechanics + tasks.md parsing run here.

const SyncBody = z.object({
  repo: repoFullName,
  spec_slug: z.string().min(1).max(200),
  tasks_markdown: z.string().min(1),
});
const ReadyQuery = z.object({ repo: repoFullName });
const ClaimBody = z.object({
  task_id: z.string().min(1),
  agent_id: z.string().min(1).max(200),
});
const CompleteBody = z.object({ task_id: z.string().min(1) });

type SyncBody = z.infer<typeof SyncBody>;
type ReadyQuery = z.infer<typeof ReadyQuery>;
type ClaimBody = z.infer<typeof ClaimBody>;
type CompleteBody = z.infer<typeof CompleteBody>;

/** How many spec tasks the sync parsed, upserted and newly created. */
const SpecSyncSchema = z.object({
  parsed: z.number(),
  synced: z.number(),
  created: z.number(),
});

export function specTasksSyncRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/spec-tasks/sync",
    options: zodResponse(
      {
        ...bearerScope("task"),
        validate: { payload: zodValidate(SyncBody) },
      },
      SpecSyncSchema,
      {
        name: "SpecTasksSynced",
        description: "How many spec tasks the sync parsed and created",
      },
    ),
    handler: withPool(getPool, serveSpecTaskSync),
  };
}

/** Parses a tasks.md and upserts each checklist item. Idempotent by design: it runs again on every re-sync of the same spec, and must converge rather than duplicate. */
async function serveSpecTaskSync(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const body = request.payload as SyncBody;

  return respondOr500(h, () => syncedCounts(pool, body));
}

async function syncedCounts(
  pool: Pool,
  { repo, spec_slug, tasks_markdown }: SyncBody,
): Promise<{ parsed: number; synced: number; created: number }> {
  const parsed = parseTasks(tasks_markdown);

  if (parsed.length === 0) {
    return { parsed: 0, synced: 0, created: 0 };
  }
  const target = { repo, specSlug: spec_slug };
  const { synced, created } = await syncTasksToDb(pool, target, parsed);

  return { parsed: parsed.length, synced, created };
}

/** The spec tasks whose dependencies have all merged. */
const SpecReadySchema = z.object({
  tasks: z.array(z.record(z.string(), z.unknown())),
});

export function specTasksReadyRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/spec-tasks/ready",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(ReadyQuery) },
      },
      SpecReadySchema,
      {
        name: "SpecTasksReady",
        description: "Spec tasks whose dependencies have merged",
      },
    ),
    handler: withPool(getPool, serveSpecTasksReady),
  };
}

async function serveSpecTasksReady(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { repo } = request.query as unknown as ReadyQuery;

  return respondOr500(h, async () => ({
    tasks: await getReadyTasks(pool, repo),
  }));
}

/** Whether the claim succeeded, and who now holds the task. */
const SpecClaimSchema = z.object({
  claimed: z.boolean(),
  task_id: z.string(),
  agent_id: z.string(),
});

export function specTasksClaimRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/spec-tasks/claim",
    options: zodResponse(
      {
        ...bearerScope("task"),
        validate: { payload: zodValidate(ClaimBody) },
      },
      SpecClaimSchema,
      { name: "SpecTaskClaimed", description: "Whether the claim succeeded" },
    ),
    handler: withPool(getPool, serveSpecTaskClaim),
  };
}

async function serveSpecTaskClaim(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { task_id, agent_id } = request.payload as ClaimBody;

  return respondOr500(h, async () => ({
    claimed: await claimTask(pool, task_id, agent_id),
    task_id,
    agent_id,
  }));
}

/** The completed task's new state. */
const SpecCompleteSchema = z.record(z.string(), z.unknown());

export function specTasksCompleteRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/spec-tasks/complete",
    options: zodResponse(
      {
        ...bearerScope("task"),
        validate: { payload: zodValidate(CompleteBody) },
      },
      SpecCompleteSchema,
      {
        name: "SpecTaskCompleted",
        description: "The completed task's new state",
      },
    ),
    handler: withPool(getPool, serveSpecTaskComplete),
  };
}

async function serveSpecTaskComplete(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { task_id } = request.payload as CompleteBody;

  return respondOr500(h, () => completeTask(pool, task_id));
}

/** Every operation in the DAG answers a failure the same way: a 500 carrying the message, because the MCP tools on the other end report it verbatim to the developer. */
async function respondOr500(
  h: ResponseToolkit,
  read: () => Promise<object>,
): Promise<ResponseObject> {
  try {
    return h.response(await read());
  } catch (err) {
    return h.response({ error: errorMessage(err) }).code(500);
  }
}
