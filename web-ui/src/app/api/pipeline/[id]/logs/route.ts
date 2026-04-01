export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

interface Task {
  id: string;
  status: string;
}

interface LogEvent {
  metadata: { output?: string; captured_at?: string } | null;
  created_at: string;
}

/**
 * GET /api/pipeline/[id]/logs
 *
 * Returns the latest log output for a task.
 *
 * Query params:
 *   since=<ISO timestamp> — only return log events newer than this timestamp
 *
 * Response JSON:
 *   { logs: string, status: string, timestamp: string }
 *
 * Sources:
 *   - Running tasks: latest 'log' event in task_events (written by loretask-watcher every ~60s)
 *   - Completed tasks: output from the final status event metadata
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const since = searchParams.get('since');

  try {
    const task = await queryOne<Task>(
      `SELECT id, status FROM pipeline.tasks WHERE id = $1`,
      [id],
    );
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // For running tasks: return the most recent log snapshot
    if (task.status === 'running') {
      const sinceClause = since ? `AND created_at > $2` : '';
      const sinceParam = since ? [id, since] : [id];

      const rows = await query<LogEvent>(
        `SELECT metadata, created_at
         FROM pipeline.task_events
         WHERE task_id = $1 AND to_status = 'log' ${sinceClause}
         ORDER BY created_at DESC
         LIMIT 1`,
        sinceParam,
      );

      const latest = rows[0];
      return NextResponse.json({
        logs: latest?.metadata?.output ?? null,
        status: task.status,
        timestamp: latest?.created_at ?? null,
      });
    }

    // For completed/failed tasks: return the output stored in the final event
    const rows = await query<LogEvent>(
      `SELECT metadata, created_at
       FROM pipeline.task_events
       WHERE task_id = $1 AND to_status = 'log'
       ORDER BY created_at DESC
       LIMIT 1`,
      [id],
    );

    const latest = rows[0];
    return NextResponse.json({
      logs: latest?.metadata?.output ?? null,
      status: task.status,
      timestamp: latest?.created_at ?? null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
