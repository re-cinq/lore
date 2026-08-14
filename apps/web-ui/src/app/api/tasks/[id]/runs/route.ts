export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getTask, getTaskRuns } from "@/lib/api/tasks";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { serverError, upstreamError } from "@/lib/api-error";

/**
 * GET /api/tasks/[id]/runs — the task's per-attempt assembly-line runs, newest
 * first. Exists so the task page's refresh coordinator can discover a run that
 * starts after the page rendered and attach the live event stream to it. Same
 * auth ladder as the sibling timeline route: session (401) → task (404) →
 * repo access (403). Empty list on pre-0025 databases.
 *
 * The task read and the run list both come from lore-api: the repo this route
 * authorizes against must be the one the runs were read for, so resolving it
 * from a second source is how the two drift.
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

    const task = await getTask(id);

    if (task.status !== "ok") {
      return upstreamError("Task runs", task);
    }

    if (
      !(await userCanAccessRepo(session.accessToken, task.data.target_repo))
    ) {
      return NextResponse.json(
        { error: "Access denied — you do not have access to this repo" },
        { status: 403 },
      );
    }

    const runs = await getTaskRuns(id);

    if (runs.status !== "ok") {
      return upstreamError("Task runs", runs);
    }

    return NextResponse.json({ runs: runs.data.runs });
  } catch (err) {
    return serverError("task-runs", err);
  }
}
