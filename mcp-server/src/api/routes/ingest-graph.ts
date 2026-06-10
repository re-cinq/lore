/**
 * `POST /api/repos/:o/:r/ingest-graph` — the REST/curl/CI trigger for
 * spec-traceability graph (re-)projection. Fans out per-kind ingest tasks
 * for the repo via `createIngestGraphTasks` and returns its result as JSON.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { createIngestGraphTasks } from "../../features/spec-trace/ingest-graph-tasks.js";
import { json, readJsonBody, repoFromReposUrl } from "./http.js";

interface IngestGraphBody {
  kinds?: string[];
  force?: boolean;
}

export async function handleIngestGraphRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool | null,
): Promise<void> {
  // Fan-out needs a live pool (creates pipeline tasks); the shared
  // DB-less server fails soft with 503, matching task-timeline/dark-factory.
  if (!pool) {
    json(res, 503, { error: "database unavailable" });
    return;
  }

  const repo = repoFromReposUrl(req.url);
  if (!repo) {
    json(res, 400, { error: "could not resolve repo from url" });
    return;
  }

  const body = (await readJsonBody(req)) as IngestGraphBody;
  const result = await createIngestGraphTasks(pool, repo, {
    kinds: body.kinds,
    force: body.force,
    createdBy: "api",
  });
  json(res, 200, result);
}
