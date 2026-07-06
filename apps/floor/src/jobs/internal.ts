/**
 * Layer-3 handlers for mcp-server post-ingest events (source `internal`). These
 * were the `/api/trigger/spec-trace` and `/api/trigger/spec-coverage-validate`
 * endpoints; now the event loop drives them.
 */

import { createDgraphClient } from "@re-cinq/lore-shared";
import { dispatchSpecTrace } from "./spec-trace/spec-trace-dispatch.js";
import { projectFor } from "../composition/project-boot.js";
import { writeAuditLog } from "./lib/audit.js";
import { validateSpecCoverageJob } from "@re-cinq/lore-shared/detect/index.js";
import type { EventHandler } from "../main-loop/types.js";

export const specTrace: EventHandler = async (params) => {
  const { repo, kind, payload } = params as { repo: string; kind: string; payload: unknown };
  const dgraph = createDgraphClient();
  if (!dgraph) {
    // Projection is opt-in until Dgraph is provisioned — success no-op, not a retry.
    console.log(`[events] spec-trace skipped for ${repo} (${kind}): LORE_DGRAPH_HTTP not configured`);
    return;
  }
  const { logLine, audit } = await dispatchSpecTrace(repo, kind, payload, { dgraph, projectFor });
  console.log(logLine);
  await writeAuditLog(audit).catch((err) =>
    console.error(`[events] spec-trace audit write failed for ${repo}:`, err),
  );
};

export const specCoverageValidate: EventHandler = async (params) => {
  const { repo } = params as { repo: string };
  await validateSpecCoverageJob({ repoFilter: repo, project: await projectFor(repo) });
};
