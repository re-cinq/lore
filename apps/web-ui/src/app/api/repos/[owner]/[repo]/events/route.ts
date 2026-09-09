export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { pageOffsetParam } from "@/lib/page-offset";
import { fetchRepoEvents } from "@/app/repos/[owner]/[repo]/events/events-data";
import { repoRoute } from "@/lib/repo-route";

// Subsequent-page endpoint for the per-repo events list; session enforced upstream by withAuth (middleware.ts).
export const GET = repoRoute("repo-events", async (fullName, searchParams) =>
  NextResponse.json(
    await fetchRepoEvents(fullName, pageOffsetParam(searchParams)),
  ),
);
