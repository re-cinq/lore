/** Pure CI-ingest → event mapping (layer 1); no dedupe key since projection is content-hash idempotent and a `force` re-ingest must not be collapsed away. */

import type { EventInput } from "../kernel/event-types.js";

const DOC_KINDS = ["specs", "adrs"] as const;
const DOC_KIND_SET = new Set<string>(DOC_KINDS);

export interface CiIngestBody {
  repo?: string;
  kinds?: string[];
  commit?: string;
  force?: boolean;
}

export type CiIngestResult =
  | { ok: true; events: EventInput[] }
  | { ok: false; status: number; error: string };

export function mapCiIngest(body: CiIngestBody): CiIngestResult {
  if (!body.repo) {
    return { ok: false, status: 400, error: "missing repo" };
  }

  const requested =
    body.kinds && body.kinds.length > 0 ? body.kinds : [...DOC_KINDS];
  const unsupported = requested.filter((k) => !DOC_KIND_SET.has(k));

  if (unsupported.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `unsupported kind(s): ${unsupported.join(", ")} — only specs/adrs project here; test projection is CI-only (POST /test-report + /coverage)`,
    };
  }

  const events: EventInput[] = requested.map((kind) => ({
    eventName: "internal.ingest.spec_trace",
    source: "internal",
    params: {
      repo: body.repo,
      kind,
      payload: { commit: body.commit, force: body.force },
    },
  }));

  return { ok: true, events };
}
