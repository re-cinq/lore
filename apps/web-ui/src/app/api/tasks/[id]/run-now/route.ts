export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { runTaskNow } from "@/lib/api/tasks";
import { serverError, upstreamError } from "@/lib/api-error";

// Escalate a queued task to `immediate`, then bounce back to its page; lore-api owns the guard (only pending → 409 otherwise).
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
