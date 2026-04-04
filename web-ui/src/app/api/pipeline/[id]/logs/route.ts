export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { Storage } from '@google-cloud/storage';

const BUCKET = process.env.LORE_LOG_BUCKET || "lore-task-logs";

interface Task {
  id: string;
  status: string;
  target_repo: string;
}

async function checkRepoAccess(accessToken: string, repo: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  try {
    // Auth check
    const session = await getServerSession(authOptions) as any;
    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const task = await queryOne<Task>(
      `SELECT id, status, target_repo FROM pipeline.tasks WHERE id = $1`,
      [id],
    );
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    // Repo access check
    const hasAccess = await checkRepoAccess(session.accessToken, task.target_repo);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied — you do not have access to this repo' }, { status: 403 });
    }

    // Read from GCS
    const storage = new Storage();
    const file = storage.bucket(BUCKET).file(`${task.target_repo}/${task.id}/output.log`);

    const [exists] = await file.exists();
    if (!exists) {
      return NextResponse.json({ logs: null, status: task.status, totalSize: 0 });
    }

    if (offset > 0) {
      const [metadata] = await file.getMetadata();
      const totalSize = Number(metadata.size || 0);
      if (offset >= totalSize) {
        return NextResponse.json({ logs: "", status: task.status, totalSize });
      }
      const [content] = await file.download({ start: offset, end: totalSize - 1 });
      return NextResponse.json({ logs: content.toString("utf-8"), status: task.status, totalSize });
    }

    const [content] = await file.download();
    return NextResponse.json({
      logs: content.toString("utf-8"),
      status: task.status,
      totalSize: content.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
