import { zodResponse } from "../../http/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";

const JobRunLogsQuery = z.object({
  job_name: z.string().min(1).max(200),
  run_id: z.string().min(1).max(200),
});

type JobRunLogsQuery = z.infer<typeof JobRunLogsQuery>;

/** A scheduled job's log text, and whether the run has finished writing it. */
const JobRunLogsSchema = z.object({
  logs: z.string(),
  complete: z.boolean(),
});

/** One scheduled job run's captured output. Logs live server-side, so this is the only way to read a CronJob pod that has already been reaped. */
async function serveJobRunLogs(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { job_name: jobName, run_id: runId } = request.query as JobRunLogsQuery;

  try {
    const { Storage } = await import("@google-cloud/storage");
    const bucket = new Storage().bucket(
      process.env.LORE_LOG_BUCKET || "lore-task-logs",
    );
    const file = bucket.file(`__job_runs__/${jobName}/${runId}/output.log`);
    const [exists] = await file.exists();

    if (!exists) {
      return h.response({ logs: "", complete: false });
    }
    const [content] = await file.download();

    return h.response({ logs: content.toString("utf-8"), complete: true });
  } catch (err) {
    return h.response({ error: errorMessage(err) }).code(500);
  }
}

export function jobRunLogsRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/job-run-logs",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(JobRunLogsQuery) },
      },
      JobRunLogsSchema,
      { name: "JobRunLogs", description: "A job run's captured output" },
    ),
    handler: (request, h) => serveJobRunLogs(request, h),
  };
}
