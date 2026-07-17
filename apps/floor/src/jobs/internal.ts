/**
 * Layer-3 handlers for mcp-server post-ingest events (source `internal`). These
 * were the `/api/trigger/spec-trace` and `/api/trigger/spec-coverage-validate`
 * endpoints; now the event loop drives them.
 */

import { createDgraphClient } from "@re-cinq/lore-shared";
import { dispatchSpecTrace } from "./spec-trace/spec-trace-dispatch.js";
import { projectFor } from "../composition/project-boot.js";
import { insertEvent } from "../main-loop/store.js";
import { assemblyLines } from "../kernel/queues.js";
import { writeAuditLog } from "./lib/audit.js";
import type { EventHandler } from "../main-loop/types.js";

export const specTrace: EventHandler = async (params, meta) => {
  const { repo, kind, payload } = params as {
    repo: string;
    kind: string;
    payload: unknown;
  };

  // The Floor never writes dgraph itself (FR6) — the pod does — but a cluster
  // without LORE_DGRAPH_HTTP has no graph system at all, so starting lines
  // there would only burn pods. Success no-op, not a retry.
  if (!createDgraphClient()) {
    console.log(
      `[events] spec-trace skipped for ${repo} (${kind}): LORE_DGRAPH_HTTP not configured`,
    );

    return;
  }
  const { logLine, audit } = await dispatchSpecTrace(repo, kind, payload, {
    projectFor,
    insertEvent,
    // FR2/FR3: docs kinds and payload kinds run as ingest-station lines;
    // payload bodies hand off by reference through the scheduling event's id.
    startLine: (input) => assemblyLines().start(input),
    eventId: meta?.eventId,
  });

  console.log(logLine);
  await writeAuditLog(audit).catch((err) =>
    console.error(`[events] spec-trace audit write failed for ${repo}:`, err),
  );
};
