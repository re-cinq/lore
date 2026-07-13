/**
 * Pure CI-tests → event mapping (layer 1). The lore-code-trace binary posts a
 * test report (`{repo, commit, branch, tests, results}`) after running a repo's
 * suite in CI; this maps it to one `internal.ingest.spec_trace` event of kind
 * `test-report` — the same event the mcp /test-report route emitted, so the
 * registry + specTrace job stay put. No dedupe key — re-posting a commit must
 * re-ingest (content-hash idempotent). No IO; the listener does bearer auth + insert.
 */

import type { EventInput } from "../main-loop/types.js";

export interface CiTestsBody {
  repo?: string;
  commit?: string;
  branch?: string;
  tests?: unknown[];
  results?: unknown[];
}

export type CiTestsResult =
  | { ok: true; events: EventInput[] }
  | { ok: false; status: number; error: string };

export function mapCiTests(body: CiTestsBody): CiTestsResult {
  if (!body.repo) {
    return { ok: false, status: 400, error: "missing repo" };
  }

  if (!body.commit) {
    return { ok: false, status: 400, error: "missing commit" };
  }

  const { repo, ...payload } = body;

  return {
    ok: true,
    events: [
      {
        eventName: "internal.ingest.spec_trace",
        source: "internal",
        params: { repo, kind: "test-report", payload },
      },
    ],
  };
}
