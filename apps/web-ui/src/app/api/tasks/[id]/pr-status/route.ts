export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getTask } from "@/lib/api/tasks";
import { getPRDetails, isGitHubConfigured } from "@/lib/github";
import { serverError, upstreamError } from "@/lib/api-error";

/** The deployment cannot ask GitHub at all. A 503 rather than the 404 above: the task may well have a PR — we are the ones who cannot look. */
function githubUnconfigured() {
  return NextResponse.json({ error: "GitHub not configured" }, { status: 503 });
}

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

    if (!task.data.pr_number) {
      return NextResponse.json(
        { error: "No PR for this task" },
        { status: 404 },
      );
    }

    if (!isGitHubConfigured()) {
      return githubUnconfigured();
    }

    const details = await getPRDetails(
      task.data.target_repo,
      task.data.pr_number,
    );

    return NextResponse.json(details);
  } catch (err) {
    return serverError("pr-status", err);
  }
}
