import type { IncomingMessage, ServerResponse } from "node:http";
import { listTasks } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { json } from "../http.js";

export async function handleListTasks(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url!, `http://localhost`);
  const status = url.searchParams.get("status") || undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
  try {
    const result = await listTasks(status, limit);
    json(res, 200, result);
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
