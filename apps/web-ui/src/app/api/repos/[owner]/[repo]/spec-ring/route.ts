export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { fetchTraceRing } from "@/lib/trace-api";
import { repoRoute } from "@/lib/repo-route";

/** Returns one spec's two-ring structure (sections + per-statement coverage) for the expand ring. */
export const GET = repoRoute("spec-ring", async (fullName, searchParams) => {
  const specPath = searchParams.get("spec");

  if (!specPath) {
    return NextResponse.json(
      { error: "required: spec query param" },
      { status: 400 },
    );
  }

  return NextResponse.json(await fetchTraceRing(fullName, specPath));
});
