export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { fetchTraceRing } from "@/lib/trace-api";
import { serverError } from "@/lib/api-error";

/** Returns one spec's two-ring structure (sections + per-statement coverage) for the expand ring. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  const { owner, repo } = await params;
  const specPath = new URL(req.url).searchParams.get("spec");

  if (!specPath) {
    return NextResponse.json(
      { error: "required: spec query param" },
      { status: 400 },
    );
  }

  try {
    const ring = await fetchTraceRing(`${owner}/${repo}`, specPath);

    return NextResponse.json(ring);
  } catch (err) {
    return serverError("spec-ring", err);
  }
}
