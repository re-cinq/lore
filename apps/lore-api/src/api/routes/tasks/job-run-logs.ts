import type { IncomingMessage, ServerResponse } from "node:http";
import { json } from "../http.js";

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
    if (!exists) { json(res, 200, { logs: "", complete: false }); return; }
    const [content] = await file.download();
    json(res, 200, { logs: content.toString("utf-8"), complete: true });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
