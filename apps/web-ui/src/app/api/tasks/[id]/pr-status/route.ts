export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getTask, type Task } from "@/lib/api/tasks";
import { getPRDetails, isGitHubConfigured } from "@/lib/github";
import { serverError, upstreamError } from "@/lib/api-error";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const task = await getTask(id);

    if (task.status !== "ok") {
      return upstreamError("PR status", task);
    }

    return await prDetailsResponse(task.data);
  } catch (err) {
    return serverError("pr-status", err);
  }
}

/** The task's PR as GitHub reports it — or the refusal that says there is no PR, or no way to ask. */
async function prDetailsResponse(task: Task) {
  if (!task.pr_number) {
    return NextResponse.json({ error: "No PR for this task" }, { status: 404 });
  }

  if (!isGitHubConfigured()) {
    return githubUnconfigured();
  }

  const details = await getPRDetails(task.target_repo, task.pr_number);

  return NextResponse.json(details);
}

/** The deployment cannot ask GitHub at all. A 503 rather than the 404 above: the task may well have a PR — we are the ones who cannot look. */
function githubUnconfigured() {
  return NextResponse.json({ error: "GitHub not configured" }, { status: 503 });
}
