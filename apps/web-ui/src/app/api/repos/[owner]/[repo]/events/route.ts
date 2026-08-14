export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { fetchRepoEvents } from "@/app/repos/[owner]/[repo]/events/events-data";
import { serverError } from "@/lib/api-error";

// Subsequent-page endpoint for the per-repo events list. The first page is
// rendered server-side by page.tsx; this serves later pages to the
// InfiniteEvents client component. Session is enforced upstream by withAuth
// (middleware.ts).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const { searchParams } = new URL(req.url);
  const offset = Math.max(
    0,
    parseInt(searchParams.get("offset") ?? "0", 10) || 0,
  );

  try {
    return NextResponse.json(await fetchRepoEvents(fullName, offset));
  } catch (err) {
    return serverError("repo-events", err);
  }
}
