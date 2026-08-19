import { zodResponse } from "../../../server/plugins/zod-response.js";
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
  type ChangedDoc,
  type ImpactReport,
} from "@re-cinq/lore-shared";
import { z } from "zod";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";

// Fail-soft: `files` stays unknown so a malformed value degrades to [] in the
// handler (not a 400); an absent body coerces to {}.
const ImpactBody = z.preprocess(
  (v) => v ?? {},
  z.object({
    commit: z.string().optional(),
    base: z.string().optional(),
    graphCommit: z.string().nullish(),
    // Wire format. Absent means a protocol-1 client, whose diff was computed
    // against the base-branch tip — the server suppresses those findings.
    protocol: z.number().optional(),
    files: z.unknown().optional(),
    // Head content of changed spec/ADR files. The client already has the
    // checkout, so sending it here avoids a GitHub round-trip and works on fork
    // PRs. Left unknown for the same fail-soft reason as `files`.
    docs: z.unknown().optional(),
  }),
);

type ImpactBody = z.infer<typeof ImpactBody>;

const UNAVAILABLE: ImpactReport = {
  status: "unavailable",
  statements: [],
  orphaned: [],
  testSelectors: [],
};

/** A change-impact report plus the PR annotations and comment it produced. */
const ImpactReportSchema = z.record(z.unknown());

export function impactRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/impact",
    options: zodResponse(
      {
        ...bearerScope("write"),
        payload: { maxBytes: 2 * 1_048_576 },
        validate: { payload: zodValidate(ImpactBody) },
      },
      ImpactReportSchema,
      {
        name: "ImpactReport",
        description: "Coupled spec statements and orphans for a diff",
        errors: [400],
      },
    ),
    handler: async (request, h) => {
      const repo = `${request.params.owner}/${request.params.repo}`;
      const body = request.payload as ImpactBody;
      const files = Array.isArray(body.files) ? body.files : [];
      const docs = Array.isArray(body.docs) ? body.docs : [];

      const report = await safeComputeImpact(repo, files, docs, body.protocol);
      const annotations =
        report.status === "ok" ? buildImpactAnnotations(report, files) : [];
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
async function safeComputeImpact(
  repo: string,
  files: ChangedRange[],
  docs: ChangedDoc[],
  protocol: number | undefined,
): Promise<ImpactReport> {
  const dgraph = createDgraphClient(process.env);

  if (!dgraph) {
    return UNAVAILABLE;
  }

  try {
    return await computeImpact(dgraph, repo, files, { docs, protocol });
  } catch (err) {
    const reason =
      err instanceof Error ? (err.stack ?? err.message) : String(err);

    console.error(
      `[impact] query failed for ${repo} (Dgraph reachable but errored): ${reason}`,
    );

    return UNAVAILABLE;
  }
}
