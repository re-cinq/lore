export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { runTaskNow } from "@/lib/api/tasks";
import { serverError, upstreamError } from "@/lib/api-error";

/**
 * POST /api/tasks/[id]/run-now — escalate a queued task to `immediate`, then
 * bounce back to its page. lore-api owns the guard (only a pending task can be
 * escalated → 409) and records the transition with the priority it left behind.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const result = await runTaskNow(id);

    if (result.status !== "ok") {
      return upstreamError("Run now", result);
    }

    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const base = host ? `${proto}://${host}` : req.url;

    return NextResponse.redirect(new URL(`/tasks/${id}`, base));
  } catch (err) {
    return serverError("run-now", err);
  }
}
