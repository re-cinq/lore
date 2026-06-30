import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { json, readBody } from "../http.js";

export async function handleTaskLogs(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  try {
    const { task_id, repo, logs } = JSON.parse(body);
    if (!task_id || !repo || !logs) { json(res, 400, { error: "missing fields" }); return; }
    const { Storage } = await import("@google-cloud/storage");
    const bucket = new Storage().bucket(process.env.LORE_LOG_BUCKET || "lore-task-logs");
    await bucket.file(`${repo}/${task_id}/output.log`).save(logs, { resumable: false, contentType: "text/plain" });
    json(res, 200, { ok: true });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

export async function handleGetTaskLogs(req: IncomingMessage, res: ServerResponse, pool?: Pool | null): Promise<void> {
  const url = new URL(req.url!, "http://localhost");
  const taskId = url.searchParams.get("task_id");
  let repo = url.searchParams.get("repo");
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  if (!taskId) { json(res, 400, { error: "required: task_id" }); return; }
  try {
    // The local adapter no longer resolves the task's repo (it holds no DB);
    // when omitted, resolve it here from task_id before building the GCS path.
    if (!repo) {
      if (!pool) { json(res, 503, { error: "database not available to resolve task repo" }); return; }
      const { rows } = await pool.query(`SELECT target_repo FROM pipeline.tasks WHERE id = $1`, [taskId]);
      repo = rows[0]?.target_repo ?? null;
      if (!repo) { json(res, 404, { error: `task not found: ${taskId}` }); return; }
    }
    const { Storage } = await import("@google-cloud/storage");
    const bucket = new Storage().bucket(process.env.LORE_LOG_BUCKET || "lore-task-logs");
    const file = bucket.file(`${repo}/${taskId}/output.log`);
    const [exists] = await file.exists();
    if (!exists) { json(res, 200, { logs: "", next_offset: 0, complete: false }); return; }
    const [content] = await file.download();
    const full = content.toString("utf-8");
    const sliced = full.substring(offset);
    json(res, 200, { logs: sliced, next_offset: full.length, complete: true });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
