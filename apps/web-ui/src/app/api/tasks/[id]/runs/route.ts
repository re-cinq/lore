export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { queryAllowMissing, queryOne } from "@/lib/db";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { serverError } from "@/lib/api-error";

interface Task {
  id: string;
  target_repo: string;
}

interface TaskRunRow {
  id: string;
  status: string;
  outcome: string | null;
  created_at: string;
}

/**
 * GET /api/tasks/[id]/runs — the task's per-attempt assembly-line runs, newest
 * first. Exists so the task page's refresh coordinator can discover a run that
 * starts after the page rendered and attach the live event stream to it. Same
 * auth ladder as the sibling timeline route: session (401) → task (404) →
 * repo access (403). Empty list on pre-0025 databases.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const session = (await getServerSession(authOptions)) as {
      accessToken?: string;
    } | null;

    if (!session?.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const task = await queryOne<Task>(
      `SELECT id, target_repo FROM pipeline.tasks WHERE id = $1`,
      [id],
    );

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (!(await userCanAccessRepo(session.accessToken, task.target_repo))) {
      return NextResponse.json(
        { error: "Access denied — you do not have access to this repo" },
        { status: 403 },
      );
    }

    const runs = await queryAllowMissing<TaskRunRow>(
      `SELECT id, status, outcome, created_at
         FROM pipeline.assembly_lines
        WHERE task_id = $1
        ORDER BY created_at DESC`,
      [id],
    );

    return NextResponse.json({ runs });
  } catch (err) {
    return serverError("task-runs", err);
  }
}
