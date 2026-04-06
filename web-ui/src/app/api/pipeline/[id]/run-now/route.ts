export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

interface Task {
  id: string;
  status: string;
  priority: string;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const task = await queryOne<Task>(
      `SELECT id, status, priority FROM pipeline.tasks WHERE id = $1`,
      [id]
    );
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    if (task.status !== 'pending') {
      return NextResponse.json({ error: `Can only escalate pending tasks, current status: ${task.status}` }, { status: 400 });
    }

    await query(
      `UPDATE pipeline.tasks SET priority = 'immediate', updated_at = now() WHERE id = $1`,
      [id]
    );
    await query(
      `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, $2, $2, $3)`,
      [id, task.status, JSON.stringify({ action: 'run-now', previous_priority: task.priority })]
    );

    const host = _req.headers.get('x-forwarded-host') || _req.headers.get('host');
    const proto = _req.headers.get('x-forwarded-proto') || 'https';
    const base = host ? `${proto}://${host}` : _req.url;
    return NextResponse.redirect(new URL(`/pipeline/${id}`, base));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
