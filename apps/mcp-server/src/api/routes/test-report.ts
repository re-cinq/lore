/**
 * Handler for `POST /api/repos/:o/:r/test-report` — the deterministic
 * test-coverage projection. The body carries the project's `tests.list`
 * descriptors plus per-test `tests.run` results; the handler folds them
 * into the graph counts (test chunks, `validated_by` spec links,
 * coverage nodes, `covers` edges, and spec violations) and echoes them.
 * Graph persistence now happens out-of-band: after counting, the handler
 * fires a fire-and-forget spec-trace trigger to the agent (no longer a
 * pure no-op count). The trigger no-ops when the agent env is unset.
 * See `specs/project-test-interface/contracts/test-commands.md`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { TestDescriptor, TaggedRunResult } from "@re-cinq/lore-shared";
import { json, readJsonBody, repoFromReposUrl, requireCommit } from "./http.js";
import { triggerAgentSpecTrace } from "./helpers.js";

interface TestReportBody {
  commit?: string;
  branch?: string;
  tests?: TestDescriptor[];
  results?: TaggedRunResult[];
}

interface TestReportCounts {
  tests_seen: number;
  test_chunks: number;
  validated_by: number;
  coverage_nodes: number;
  covers_edges: number;
  violated: number;
}

export async function handleTestReport(
  req: IncomingMessage,
  res: ServerResponse,
  pool: Pool | null,
): Promise<void> {
  const body = (await readJsonBody(req)) as TestReportBody;

  if (!requireCommit(body, res)) return;

  const repo = repoFromReposUrl(req.url);
  if (repo) void triggerAgentSpecTrace(pool, repo, "test-report", body);

  json(res, 200, countReport(body));
}

function countReport(body: TestReportBody): TestReportCounts {
  const tests = body.tests ?? [];
  const results = body.results ?? [];
  const resultById = new Map(results.map((result) => [result.id, result]));

  return {
    tests_seen: tests.length,
    test_chunks: tests.length,
    validated_by: tests.filter((test) => test.spec).length,
    coverage_nodes: results.length,
    covers_edges: results.reduce((total, result) => total + result.covered.length, 0),
    violated: tests.filter((test) => test.spec && resultById.get(test.id)?.passed === false).length,
  };
}
