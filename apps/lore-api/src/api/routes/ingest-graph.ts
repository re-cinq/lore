/**
 * `POST /api/repos/:o/:r/ingest-graph` — the REST/curl/CI (re-)projection
 * trigger for the spec-traceability graph. Only docs (`specs`/`adrs`) flow
 * here: each fires the fire-and-forget spec-trace trigger — the coordinator
 * reads the repo and projects them into the graph, no pipeline task. Test
 * projection is CI-only (lore-tests.yml POSTs /test-report + /coverage), so a
 * non-doc kind is rejected.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { triggerAgentSpecTrace } from "./helpers.js";
import { json, readJsonBody, repoFromReposUrl } from "./http.js";

/** The only kinds this route projects — both read from repo markdown. */
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
  const unsupported = requested.filter((k) => !DOC_KINDS.has(k));
  if (unsupported.length > 0) {
    json(res, 400, {
      error: `unsupported kind(s): ${unsupported.join(", ")} — only specs/adrs project here; test projection is CI-only (POST /test-report + /coverage)`,
    });
    return;
  }

  // Each doc kind → fire-and-forget projection trigger.
  for (const kind of requested) {
    void triggerAgentSpecTrace(pool, repo, kind, { commit: body.commit, force: body.force });
  }

  json(res, 200, { triggered: requested });
}
