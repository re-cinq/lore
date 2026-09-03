export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { cancelTask } from "@/lib/api/tasks";
import { serverError, upstreamError } from "@/lib/api-error";

// Cancel a task, then bounce back to its page. State rules live in lore-api's cancel seam; this route forwards its refusal rather than re-deciding it.
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
