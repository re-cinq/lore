/** Layer-3 handlers for `internal.*` events: mcp-server post-ingest triggers (formerly `/api/trigger/spec-trace` + `/api/trigger/spec-coverage-validate`) and the web-ui settings route's team-change signal. */

import { createDgraphClient } from "@re-cinq/lore-shared";
import {
  chunkSchemaOrOrgShared,
  ORG_SHARED_SCHEMA,
} from "@re-cinq/lore-shared/project/chunks/chunk-schema.js";
import { dispatchSpecTrace } from "./spec-trace/spec-trace-dispatch.js";
import { projectFor } from "../kernel/project-boot.js";
import { insertEvent } from "../kernel/event-store.js";
import { getPool } from "../kernel/db.js";
import { pipeline, chunks, settings } from "../kernel/queues.js";
import { writeAuditLog } from "./lib/audit.js";
import type { EventHandler } from "../kernel/event-types.js";

/** `internal.repo.team_changed` — relocates legacy `org_shared.chunks` rows now (rather than waiting for the nightly reindex safety net) since a team re-point makes them invisible to resolved-schema reads; errors propagate so the event loop's retry/dead-letter can handle them. org_shared → team direction only. */
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

  // The Floor never writes dgraph itself (FR6); without LORE_DGRAPH_HTTP there's no graph system, so this is a success no-op, not a retry.
  if (!createDgraphClient()) {
    console.log(
      `[events] spec-trace skipped for ${repo} (${kind}): LORE_DGRAPH_HTTP not configured`,
    );

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
