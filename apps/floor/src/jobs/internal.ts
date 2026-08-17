/**
 * Layer-3 handlers for `internal.*` events: mcp-server post-ingest triggers
 * (formerly the `/api/trigger/spec-trace` and `/api/trigger/spec-coverage-validate`
 * endpoints) and the web-ui settings route's team-change signal.
 */

import { createDgraphClient } from "@re-cinq/lore-shared";
import {
  chunkSchemaOrOrgShared,
  ORG_SHARED_SCHEMA,
} from "@re-cinq/lore-shared/project/chunks/chunk-schema.js";
import { dispatchSpecTrace } from "./spec-trace/spec-trace-dispatch.js";
import { projectFor } from "../composition/project-boot.js";
import { insertEvent } from "../main-loop/store.js";
import { getPool } from "../kernel/db.js";
import { assemblyRuns, chunks, settings } from "../kernel/queues.js";
import { writeAuditLog } from "./lib/audit.js";
import type { EventHandler } from "../main-loop/types.js";

/**
 * `internal.repo.team_changed` — a settings write re-pointed the repo's chunk
 * resolution, so any legacy rows still in `org_shared.chunks` just became
 * invisible to every resolved-schema read. Relocate them now instead of
 * waiting for the nightly reindex (which remains the safety net for team
 * changes made outside the settings route). Re-reads the team from
 * `lore.repos` rather than trusting the event payload, so a stale or replayed
 * event relocates against the current state, and resolves it through the
 * uncached `chunkSchemaOrOrgShared` (the per-repo memoized resolver would
 * serve the pre-change schema for its TTL). A relocation error propagates on
 * purpose: relocation is idempotent, so the event loop's retry/backoff and
 * dead-letter give transient failures another shot and permanent ones
 * visibility — the nightly reindex stays the ultimate net either way. Covers
 * the org_shared → team direction only.
 */
export const repoTeamChanged: EventHandler = async (params) => {
  const { repo } = params as { repo: string };
  const team = await settings().team(repo);
  const schema = await chunkSchemaOrOrgShared(getPool(), team);

  if (schema === ORG_SHARED_SCHEMA) {
    console.log(
      `[events] team_changed for ${repo}: resolves to org_shared, nothing to relocate`,
    );

    return;
  }

  const { moved, dropped } = await chunks().relocateLegacyChunks(schema, repo);

  if (dropped > 0) {
    console.log(
      `[events] team_changed for ${repo}: moved ${moved} of ${dropped} legacy org_shared rows into ${schema} (rest were stale duplicates of files already in the target)`,
    );
  }
};

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
    startLine: (input) => assemblyRuns().start(input),
    eventId: meta?.eventId,
  });

  console.log(logLine);
  await writeAuditLog(audit).catch((err) =>
    console.error(`[events] spec-trace audit write failed for ${repo}:`, err),
  );
};
