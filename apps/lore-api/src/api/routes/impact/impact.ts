import { zodResponse } from "../../../server/plugins/zod-response.js";
/** POST /api/repos/:o/:r/impact — pre-merge spec-breakage query; fail-soft (no Dgraph). */

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

// Fail-soft: unknown files degrade to []; missing body coerces to {}.
const ImpactBody = z.preprocess(
  (v) => v ?? {},
  z.object({
    commit: z.string().optional(),
    base: z.string().optional(),
    graphCommit: z.string().nullish(),
    // Wire format; absent means protocol-1 client, server suppresses findings.
    protocol: z.number().optional(),
    files: z.unknown().optional(),
    // Head spec/ADR content (avoids GitHub round-trip on forks).
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

/** Never throws; Dgraph errors are logged (null-client is expected fail-soft). */
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
