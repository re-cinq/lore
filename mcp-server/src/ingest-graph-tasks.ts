/**
 * Fan-out creator for spec-traceability graph ingestion tasks. Shared by the
 * `ingest_graph` MCP tool and the auto path (post-onboard / post-ingest). Each
 * kind becomes one `ingest-<kind>` pipeline task (id + human description,
 * identifiable in the UI), grouped under one task_group_id, carrying the kind +
 * branch/commit/glob in its context_bundle. Dedupes against an in-flight task
 * for the same repo+kind so auto fan-out never stacks duplicates.
 */

import { randomUUID } from "node:crypto";
import { createPipelineTask, type PgPool } from "@re-cinq/lore-shared";

const DEFAULT_KINDS = ["specs", "adrs", "tests"];

export interface IngestGraphTaskOpts {
  kinds?: string[];
  branch?: string;
  commit?: string;
  glob?: string;
  createdBy?: string;
}

export async function createIngestGraphTasks(
  pool: PgPool,
  repo: string,
  opts: IngestGraphTaskOpts = {},
): Promise<{ groupId: string; created: Array<{ id: string; kind: string }>; skipped: string[] }> {
  const kinds = opts.kinds && opts.kinds.length > 0 ? opts.kinds : DEFAULT_KINDS;
  const groupId = randomUUID();
  const created: Array<{ id: string; kind: string }> = [];
  const skipped: string[] = [];

  for (const kind of kinds) {
    const taskType = `ingest-${kind}`;
    const existing = await pool.query(
      `SELECT id FROM pipeline.tasks
        WHERE target_repo = $1 AND task_type = $2
          AND status IN ('pending', 'queued', 'running', 'running-local')
        LIMIT 1`,
      [repo, taskType],
    );
    if (existing.rows.length > 0) {
      skipped.push(kind);
      continue;
    }
    const task = await createPipelineTask(pool, {
      taskType,
      description: `Ingest ${kind} → graph for ${repo}`,
      targetRepo: repo,
      createdBy: opts.createdBy ?? "ingest_graph",
      taskGroupId: groupId,
      contextBundle: { kind, branch: opts.branch, commit: opts.commit, glob: opts.glob },
    });
    created.push({ id: task.id, kind });
  }

  return { groupId, created, skipped };
}
