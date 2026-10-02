/** Layer-3 handlers for `internal.*` events: mcp-server post-ingest trigger (formerly `/api/trigger/spec-trace`). */

import { createDgraphClient } from "@re-cinq/lore-shared";
import { dispatchSpecTrace } from "../../work/spec-trace/spec-trace-dispatch.js";
import { projectFor } from "../../outbound/project-boot.js";
import { insertEvent } from "../../outbound/event-store.js";
import { pipeline } from "../../outbound/queues.js";
import { writeAuditLog } from "../../outbound/audit.js";
import type { EventHandler } from "../../domain/event-types.js";

// The Floor never writes dgraph itself (FR6); without LORE_DGRAPH_HTTP there's no graph system, so a miss is a success no-op, not a retry.
function graphConfigured(repo: string, kind: string): boolean {
  if (createDgraphClient()) {
    return true;
  }
  console.log(
    `[events] spec-trace skipped for ${repo} (${kind}): LORE_DGRAPH_HTTP not configured`,
  );

  return false;
}

export const specTrace: EventHandler = async (params, meta) => {
  const { repo, kind, payload } = params as {
    repo: string;
    kind: string;
    payload: unknown;
  };

  if (!graphConfigured(repo, kind)) {
    return;
  }
  const { logLine, audit } = await dispatchSpecTrace(repo, kind, payload, {
    projectFor,
    insertEvent,
    // FR2/FR3: payload bodies hand off by reference through the scheduling event's id.
    startLine: (input) => pipeline().assemblyRuns.start(input),
    eventId: meta?.eventId,
  });

  console.log(logLine);
  await writeAuditLog(audit).catch((err) =>
    console.error(`[events] spec-trace audit write failed for ${repo}:`, err),
  );
};
