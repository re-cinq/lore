import type { ServerRoute } from "@hapi/hapi";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

export function jobRunLogsRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/job-run-logs",
    options: bearerScope("read"),
    handler: async (request, h) => {
      const q = request.query as Record<string, string | undefined>;
      const jobName = q.job_name;
      const runId = q.run_id;
      if (!jobName || !runId) return h.response({ error: "required: job_name, run_id" }).code(400);
      try {
        const { Storage } = await import("@google-cloud/storage");
        const bucket = new Storage().bucket(process.env.LORE_LOG_BUCKET || "lore-task-logs");
        const file = bucket.file(`__job_runs__/${jobName}/${runId}/output.log`);
        const [exists] = await file.exists();
        if (!exists) return h.response({ logs: "", complete: false });
        const [content] = await file.download();
        return h.response({ logs: content.toString("utf-8"), complete: true });
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
