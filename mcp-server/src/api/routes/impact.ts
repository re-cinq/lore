/**
 * `POST /api/repos/:o/:r/impact` — the deterministic, zero-LLM pre-merge
 * spec-breakage query. Body: `{ commit?, base?, files: [{ path, ranges, deleted }] }`
 * (a PR diff). Walks the spec-traceability graph to the coupled spec Statements
 * + orphaned (coverage-deleted) statements and returns the `ImpactReport` plus
 * pre-shaped Checks-API `annotations[]` the GitHub Action renders verbatim.
 *
 * Fail-soft by design: when Dgraph is unreachable (`LORE_DGRAPH_HTTP` unset on
 * the shared server) or the query errors, returns `200 { status:"unavailable" }`
 * — NOT an error — so the advisory Action posts its neutral skip comment and
 * never red-Xes the PR. Read-only; the trust gate that forbids test *execution*
 * does not apply to a graph read.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import {
  createDgraphClient,
  computeImpact,
  buildImpactAnnotations,
  buildImpactComment,
  type ChangedRange,
  type ImpactReport,
} from "@re-cinq/lore-shared";
import { json, readJsonBody, repoFromReposUrl } from "./http.js";

interface ImpactBody {
  commit?: string;
  base?: string;
  files?: ChangedRange[];
}

const UNAVAILABLE: ImpactReport = { status: "unavailable", statements: [], orphaned: [], testSelectors: [] };

export async function handleImpactRoute(
  req: IncomingMessage,
  res: ServerResponse,
  _pool: Pool | null,
): Promise<void> {
  const repo = repoFromReposUrl(req.url);
  if (!repo) {
    json(res, 400, { error: "could not resolve repo from url" });
    return;
  }

  const body = (await readJsonBody(req)) as ImpactBody;
  const files = Array.isArray(body.files) ? body.files : [];

  const report = await safeComputeImpact(repo, files);
  const annotations = report.status === "ok" ? buildImpactAnnotations(report, files) : [];
  const comment = buildImpactComment(report);
  json(res, 200, { ...report, annotations, comment });
}

/** Never throws: a Dgraph outage degrades to `unavailable`, not a 500. */
async function safeComputeImpact(repo: string, files: ChangedRange[]): Promise<ImpactReport> {
  try {
    return await computeImpact(createDgraphClient(process.env), repo, files);
  } catch {
    return UNAVAILABLE;
  }
}
