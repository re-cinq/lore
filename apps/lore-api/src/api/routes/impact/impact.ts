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

import type { ServerRoute } from "@hapi/hapi";
import {
  createDgraphClient,
  computeImpact,
  buildImpactAnnotations,
  buildImpactComment,
  type ChangedRange,
  type ImpactReport,
} from "@re-cinq/lore-shared";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { parseJsonBodyCapped } from "../../../server/raw-body.js";

interface ImpactBody {
  commit?: string;
  base?: string;
  files?: ChangedRange[];
}

const UNAVAILABLE: ImpactReport = { status: "unavailable", statements: [], orphaned: [], testSelectors: [] };

export function impactRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/impact",
    options: { ...bearerScope("write"), payload: { parse: false, maxBytes: 2 * 1_048_576 } },
    handler: async (request, h) => {
      const repo = `${request.params.owner}/${request.params.repo}`;
      let body: ImpactBody;
      try {
        body = parseJsonBodyCapped(request) as ImpactBody;
      } catch (err) {
        return h.response({ error: "invalid_body", detail: (err as Error).message }).code(400);
      }
      const files = Array.isArray(body.files) ? body.files : [];

      const report = await safeComputeImpact(repo, files);
      const annotations = report.status === "ok" ? buildImpactAnnotations(report, files) : [];
      const comment = buildImpactComment(report);
      return h.response({ ...report, annotations, comment });
    },
  };
}

/**
 * Never throws: a Dgraph outage degrades to `unavailable`, not a 500. But it is
 * NOT silent — a query error (reachable Dgraph, broken DQL / missing schema) is
 * logged with context. The null-client case (LORE_DGRAPH_HTTP unset) is the
 * expected fail-soft and needs no log.
 */
async function safeComputeImpact(repo: string, files: ChangedRange[]): Promise<ImpactReport> {
  const dgraph = createDgraphClient(process.env);
  if (!dgraph) return UNAVAILABLE;
  try {
    return await computeImpact(dgraph, repo, files);
  } catch (err) {
    const reason = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`[impact] query failed for ${repo} (Dgraph reachable but errored): ${reason}`);
    return UNAVAILABLE;
  }
}
