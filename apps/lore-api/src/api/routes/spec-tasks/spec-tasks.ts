import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import {
  parseTasks,
  syncTasksToDb,
  getReadyTasks,
  claimTask,
  completeTask,
} from "@re-cinq/lore-server-core/features/pipeline/tasks.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE, repoFullName } from "../common-schemas.js";

/**
 * The spec-task DAG (sync → ready → claim → complete) over HTTP, for the MCP
 * tools of the same names: the local adapter holds no pool (ADR-032), so the
 * queue mechanics run here. Markdown parsing runs server-side too, so the
 * tasks.md grammar has exactly one home.
 */

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

export function specTasksSyncRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/spec-tasks/sync",
    options: {
      ...bearerScope("task"),
      validate: { payload: zodValidate(SyncBody) },
    },
    handler: async (request, h) => {
      const pool = getPool();

      if (!pool) {
        return h.response({ error: DB_UNAVAILABLE }).code(503);
      }

      const { repo, spec_slug, tasks_markdown } = request.payload as SyncBody;

      try {
        const parsed = parseTasks(tasks_markdown);

        if (parsed.length === 0) {
          return h.response({ parsed: 0, synced: 0, created: 0 });
        }
        const { synced, created } = await syncTasksToDb(
          pool,
          repo,
          spec_slug,
          parsed,
        );

        return h.response({ parsed: parsed.length, synced, created });
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}

export function specTasksReadyRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/spec-tasks/ready",
    options: {
      ...bearerScope("read"),
      validate: { query: zodValidate(ReadyQuery) },
    },
    handler: async (request, h) => {
      const pool = getPool();

      if (!pool) {
        return h.response({ error: DB_UNAVAILABLE }).code(503);
      }

      const { repo } = request.query as unknown as ReadyQuery;

      try {
        return h.response({ tasks: await getReadyTasks(pool, repo) });
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}

export function specTasksClaimRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/spec-tasks/claim",
    options: {
      ...bearerScope("task"),
      validate: { payload: zodValidate(ClaimBody) },
    },
    handler: async (request, h) => {
      const pool = getPool();

      if (!pool) {
        return h.response({ error: DB_UNAVAILABLE }).code(503);
      }

      const { task_id, agent_id } = request.payload as ClaimBody;

      try {
        const claimed = await claimTask(pool, task_id, agent_id);

        return h.response({ claimed, task_id, agent_id });
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}

export function specTasksCompleteRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/spec-tasks/complete",
    options: {
      ...bearerScope("task"),
      validate: { payload: zodValidate(CompleteBody) },
    },
    handler: async (request, h) => {
      const pool = getPool();

      if (!pool) {
        return h.response({ error: DB_UNAVAILABLE }).code(503);
      }

      const { task_id } = request.payload as CompleteBody;

      try {
        return h.response(await completeTask(pool, task_id));
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
