export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getPRDetails, isGitHubConfigured } from '@/lib/github';

interface Task {
  target_repo: string;
  pr_number: number | null;
  pr_url: string | null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const task = await queryOne<Task>(
      `SELECT target_repo, pr_number, pr_url FROM pipeline.tasks WHERE id = $1`,
      [id]
    );
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (!task.pr_number) return NextResponse.json({ error: 'No PR for this task' }, { status: 404 });

    if (!isGitHubConfigured()) {
      return NextResponse.json({ error: 'GitHub not configured' }, { status: 503 });
    }

    const details = await getPRDetails(task.target_repo, task.pr_number);
    return NextResponse.json(details);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
