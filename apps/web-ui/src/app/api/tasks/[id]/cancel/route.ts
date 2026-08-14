export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { cancelTask } from "@/lib/api/tasks";
import { serverError, upstreamError } from "@/lib/api-error";

/**
 * POST /api/tasks/[id]/cancel — cancel a task, then bounce back to its page.
 *
 * The state rules (unknown id → 404, terminal task → 409) live in lore-api's
 * cancel seam, which also records the transition in pipeline.task_events. This
 * route forwards the refusal it was given rather than re-deciding it: two copies
 * of "which statuses are cancellable" is how the browser came to answer 400 for
 * a completed task while the API answered 200.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const result = await cancelTask(id);

    if (result.status !== "ok") {
      return upstreamError("Cancel", result);
    }

    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const base = host ? `${proto}://${host}` : req.url;

    return NextResponse.redirect(new URL(`/tasks/${id}`, base));
  } catch (err) {
    return serverError("cancel", err);
  }
}
