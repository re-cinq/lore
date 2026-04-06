export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

interface Task {
  id: string;
  status: string;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const task = await queryOne<Task>(
      `SELECT id, status FROM pipeline.tasks WHERE id = $1`,
      [id]
    );
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    if (['merged', 'failed', 'cancelled'].includes(task.status)) {
      return NextResponse.json({ error: `Cannot cancel task in ${task.status} state` }, { status: 400 });
    }

    await query(
      `UPDATE pipeline.tasks SET status = 'cancelled', failure_reason = 'Cancelled by user', updated_at = now() WHERE id = $1`,
      [id]
    );
    await query(
      `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, $2, 'cancelled', $3)`,
      [id, task.status, JSON.stringify({ cancelled_by: 'ui' })]
    );

    const host = _req.headers.get('x-forwarded-host') || _req.headers.get('host');
    const proto = _req.headers.get('x-forwarded-proto') || 'https';
    const base = host ? `${proto}://${host}` : _req.url;
    return NextResponse.redirect(new URL(`/pipeline/${id}`, base));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
