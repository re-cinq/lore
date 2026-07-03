import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { rawBody } from "../../../server/raw-body.js";

// Both verbs resolve to the "task" scope: `getRequiredScope` matches by prefix,
// first-match-wins, and "/api/task-logs".startsWith("/api/task") is true, so the
// "/api/task"→"task" entry shadowed the (dead) "/api/task-logs"→"write" one. The
// native routes reproduce that exact scope.
export function taskLogsPostRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/task-logs",
    options: { ...bearerScope("task"), payload: { parse: false } },
    handler: async (request, h) => {
      try {
        const { task_id, repo, logs } = JSON.parse(rawBody(request));
        if (!task_id || !repo || !logs) return h.response({ error: "missing fields" }).code(400);
        const { Storage } = await import("@google-cloud/storage");
        const bucket = new Storage().bucket(process.env.LORE_LOG_BUCKET || "lore-task-logs");
        await bucket.file(`${repo}/${task_id}/output.log`).save(logs, { resumable: false, contentType: "text/plain" });
        return h.response({ ok: true });
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}

export function taskLogsGetRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/task-logs",
    options: bearerScope("task"),
    handler: async (request, h) => {
      const q = request.query as Record<string, string | undefined>;
      const taskId = q.task_id;
      let repo = q.repo ?? null;
      const offset = parseInt(q.offset || "0", 10);
      if (!taskId) return h.response({ error: "required: task_id" }).code(400);

      try {
        // The local adapter no longer resolves the task's repo (it holds no DB);
        // when omitted, resolve it here from task_id before building the GCS path.
        if (!repo) {
          const pool = getPool();
          if (!pool) return h.response({ error: "database not available to resolve task repo" }).code(503);
          const { rows } = await pool.query(`SELECT target_repo FROM pipeline.tasks WHERE id = $1`, [taskId]);
          repo = rows[0]?.target_repo ?? null;
          if (!repo) return h.response({ error: `task not found: ${taskId}` }).code(404);
        }
        const { Storage } = await import("@google-cloud/storage");
        const bucket = new Storage().bucket(process.env.LORE_LOG_BUCKET || "lore-task-logs");
        const file = bucket.file(`${repo}/${taskId}/output.log`);
        const [exists] = await file.exists();
        if (!exists) return h.response({ logs: "", next_offset: 0, complete: false });
        const [content] = await file.download();
        const full = content.toString("utf-8");
        return h.response({ logs: full.substring(offset), next_offset: full.length, complete: true });
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
