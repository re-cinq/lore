export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { query } from '@/lib/db';
import { serverError } from '@/lib/api-error';

// Only `tests` is a graph-ingest task. specs/adrs project via the CI-driven
// spec-trace trigger (lore-ingest.yml → mcp-server /ingest-graph), not this route.
const DEFAULT_KINDS = ['tests'];
const ALLOWED = new Set(DEFAULT_KINDS);

/**
 * Creates the `ingest-tests` pipeline task for a repo (the test-suite graph
 * ingest), grouped under one task_group_id, with an in-flight dedupe. web-ui is
 * not an npm workspace member, so this inserts directly via the db pool (mirrors
 * mcp-server's createIngestGraphTasks). Docs are CI-only — not handled here.
 */
export async function POST(req: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  try {
    const body = (await req.json().catch(() => ({}))) as { kinds?: string[] };
    const kinds = (body.kinds?.filter((k) => ALLOWED.has(k)) ?? []).length ? body.kinds! : DEFAULT_KINDS;

    const groupId = randomUUID();
    const created: Array<{ id: string; kind: string }> = [];
    const skipped: string[] = [];

    for (const kind of kinds) {
      const taskType = `ingest-${kind}`;
      const existing = await query<{ id: string }>(
        `SELECT id FROM pipeline.tasks
          WHERE target_repo = $1 AND task_type = $2
            AND status IN ('pending', 'queued', 'running', 'running-local')
          LIMIT 1`,
        [fullName, taskType],
      );
      if (existing.length > 0) {
        skipped.push(kind);
        continue;
      }
      const rows = await query<{ id: string }>(
        `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle, task_group_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [`Ingest ${kind} → graph for ${fullName}`, taskType, fullName, 'web-ui', JSON.stringify({ kind }), groupId],
      );
      created.push({ id: rows[0].id, kind });
    }

    return NextResponse.json({ groupId, created, skipped });
  } catch (err) {
    return serverError('ingest-graph', err);
  }
}
