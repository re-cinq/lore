/**
 * Handler for `POST /api/repos/:o/:r/test-report` — the deterministic
 * test-coverage projection. The body carries the project's `tests.list`
 * descriptors plus per-test `tests.run` results; the handler folds them
 * into the graph counts (test chunks, `validated_by` spec links,
 * coverage nodes, `covers` edges, and spec violations) and echoes them.
 * Graph persistence is a deferred seam — no DB write yet.
 * See `specs/project-test-interface/contracts/test-commands.md`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { TestDescriptor, TaggedRunResult } from "@re-cinq/lore-shared";
import { json, readJsonBody, requireCommit } from "./http.js";

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
  _pool: Pool | null,
): Promise<void> {
  // Graph persistence is a deferred seam (no Dgraph projection layer yet),
  // so `_pool` is intentionally untouched.
  const body = (await readJsonBody(req)) as TestReportBody;

  if (!requireCommit(body, res)) return;

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
