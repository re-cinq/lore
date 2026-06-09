import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { ingestFiles } from "../ingest.js";
import { onboardRepo } from "../repo-onboard.js";
import { json, readBody } from "./http.js";
import { triggerAgentSpecCoverageValidate } from "./helpers.js";
import { maybeAutoIngestGraph } from "../ingest-graph-tasks.js";

export async function handleIngest(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  if (!pool) { json(res, 503, { error: "database not available" }); return; }
  const body = await readBody(req);
  try {
    const { files, repo, commit } = JSON.parse(body);
    if (!Array.isArray(files) || !repo) {
      json(res, 400, { error: "required: files (array of paths or {path,content}), repo (string)" });
      return;
    }
    const result = await ingestFiles(pool, files, repo, commit || "HEAD");
    json(res, 200, result);
    // Post-ingest fan-out: re-link tests against any changed specs (and let
    // newly-ingested tests find a statement in unchanged specs). Fire-and-
    // forget — the response has already been written; agent returns 202
    // and the content-hash gate elides the work when nothing relevant
    // changed. Gated on at least one file actually landing (no point
    // firing for an all-skipped/all-error batch).
    const landed = Array.isArray(result?.results)
      ? result.results.some((r: { status?: string }) => r.status === "ingested" || r.status === "deleted")
      : false;
    if (landed) {
      void triggerAgentSpecCoverageValidate(repo);
      // Auto fan-out the spec-traceability graph re-projection, but only for
      // repos that opted in (settings.auto_ingest_graph). Fire-and-forget.
      void maybeAutoIngestGraph(pool, repo);
    }
  } catch (err: any) {
    console.error("[ingest] API error:", err.message);
    json(res, 500, { error: err.message });
  }
}

export async function handleOnboard(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  if (!pool) { json(res, 503, { error: "database not available" }); return; }
  const body = await readBody(req);
  try {
    const { repo } = JSON.parse(body);
    if (!repo || !repo.includes("/")) {
      json(res, 400, { error: "required: repo (owner/name format)" });
      return;
    }
    const result = await onboardRepo(pool, repo);
    json(res, 200, result);
  } catch (err: any) {
    console.error("[onboard] API error:", err.message);
    json(res, 500, { error: err.message });
  }
}
