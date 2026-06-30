import type { IncomingMessage, ServerResponse } from "node:http";
import { getTask } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { json } from "../http.js";

export async function handleGetTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const taskId = req.url!.replace("/api/task/", "");
  try {
    const task = await getTask(taskId);
    if (!task) { json(res, 404, { error: "not found" }); return; }
    json(res, 200, task);
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
