import type { IncomingMessage, ServerResponse } from "node:http";
import { json, readBody } from "./http.js";

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

export async function handleGetTaskLogs(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url!, "http://localhost");
  const taskId = url.searchParams.get("task_id");
  const repo = url.searchParams.get("repo");
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  if (!taskId || !repo) { json(res, 400, { error: "required: task_id, repo" }); return; }
  try {
    const { Storage } = await import("@google-cloud/storage");
    const bucket = new Storage().bucket(process.env.LORE_LOG_BUCKET || "lore-task-logs");
    const file = bucket.file(`${repo}/${taskId}/output.log`);
    const [exists] = await file.exists();
    if (!exists) { json(res, 200, { logs: "", next_offset: 0, complete: true }); return; }
    const [content] = await file.download();
    const full = content.toString("utf-8");
    const sliced = full.substring(offset);
    json(res, 200, { logs: sliced, next_offset: full.length, complete: true });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

export async function handleGetJobRunLogs(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url!, "http://localhost");
  const jobName = url.searchParams.get("job_name");
  const runId = url.searchParams.get("run_id");
  if (!jobName || !runId) { json(res, 400, { error: "required: job_name, run_id" }); return; }
  try {
    const { Storage } = await import("@google-cloud/storage");
    const bucket = new Storage().bucket(process.env.LORE_LOG_BUCKET || "lore-task-logs");
    const file = bucket.file(`__job_runs__/${jobName}/${runId}/output.log`);
    const [exists] = await file.exists();
    if (!exists) { json(res, 200, { logs: "", complete: true }); return; }
    const [content] = await file.download();
    json(res, 200, { logs: content.toString("utf-8"), complete: true });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
