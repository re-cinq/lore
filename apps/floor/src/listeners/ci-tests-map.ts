// Pure CI-tests → event mapping (layer 1): maps the lore-code-trace binary's posted test report to one `internal.ingest.spec_trace` event of kind `test-report` (same event the old mcp /test-report route emitted); no dedupe key since re-posting a commit must re-ingest (content-hash idempotent).

import type { EventInput } from "../kernel/event-types.js";

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
