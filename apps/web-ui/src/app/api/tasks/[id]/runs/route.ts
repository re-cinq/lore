export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getTask, getTaskRuns } from "@/lib/api/tasks";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { resolveSessionAccessToken } from "@/lib/session-access-token";
import { serverError, upstreamError } from "@/lib/api-error";

/** Session → task → repo-access ladder, so a caller who fails it never learns the task's repo. */
async function authorizeTaskAccess(
  id: string,
): Promise<{ accessToken: string; targetRepo: string } | NextResponse> {
  const accessToken = await resolveSessionAccessToken();

  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const task = await getTask(id);

  if (task.status !== "ok") {
    return upstreamError("Task runs", task);
  }

  if (!(await userCanAccessRepo(accessToken, task.data.target_repo))) {
    return NextResponse.json(
      { error: "Access denied — you do not have access to this repo" },
      { status: 403 },
    );
  }

  return { accessToken, targetRepo: task.data.target_repo };
}

// Task's per-attempt runs, newest first, so the refresh coordinator can attach the live stream to a run started after render. Same 401→404→403 ladder as the timeline route; task + runs both come from lore-api so the authorized repo can't drift from a second source.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const auth = await authorizeTaskAccess(id);

    if (auth instanceof Response) {
      return auth;
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
