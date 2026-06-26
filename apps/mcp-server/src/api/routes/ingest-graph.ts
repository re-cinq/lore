/**
 * `POST /api/repos/:o/:r/ingest-graph` — the REST/curl/CI (re-)projection
 * trigger for the spec-traceability graph. Docs (`specs`/`adrs`) fire the
 * fire-and-forget spec-trace trigger — the coordinator reads the repo and
 * projects them into the graph, no pipeline task. `tests` keeps the task path
 * (it runs the project's test suite, so it needs a runner / CI sandbox).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { createIngestGraphTasks } from "../../features/spec-trace/ingest-graph-tasks.js";
import { triggerAgentSpecTrace } from "./helpers.js";
import { json, readJsonBody, repoFromReposUrl } from "./http.js";

/** Kinds projected from repo markdown — fired as triggers, never tasks. */
const DOC_KINDS = new Set(["specs", "adrs"]);

interface IngestGraphBody {
  kinds?: string[];
  commit?: string;
  force?: boolean;
}

export async function handleIngestGraphRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool | null,
): Promise<void> {
  const repo = repoFromReposUrl(req.url);
  if (!repo) {
    json(res, 400, { error: "could not resolve repo from url" });
    return;
  }

  const body = (await readJsonBody(req)) as IngestGraphBody;
  const requested = body.kinds && body.kinds.length > 0 ? body.kinds : ["specs", "adrs"];
  const docKinds = requested.filter((k) => DOC_KINDS.has(k));
  const taskKinds = requested.filter((k) => !DOC_KINDS.has(k));

  // Decide the pool requirement up front: tests need a live pool, docs don't. A
  // mixed request must never fire a doc trigger and *then* 503 on the task half
  // (a partial side effect the caller would read as a clean failure).
  if (taskKinds.length > 0 && !pool) {
    json(res, 503, { error: "database unavailable" });
    return;
  }

  // Docs → fire-and-forget projection trigger, one per kind.
  for (const kind of docKinds) {
    void triggerAgentSpecTrace(repo, kind, { commit: body.commit, force: body.force });
  }

  // Non-doc kinds (tests) create a pipeline task — pool is non-null past the guard.
  const tasks =
    taskKinds.length > 0
      ? await createIngestGraphTasks(pool!, repo, { kinds: taskKinds, force: body.force, createdBy: "api" })
      : null;

  json(res, 200, { triggered: docKinds, tasks });
}
