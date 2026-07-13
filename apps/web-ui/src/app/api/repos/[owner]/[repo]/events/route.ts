export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  EVENTS_PAGE_SIZE,
  repoEventsQuery,
  type RepoEvent,
} from "@/app/repos/[owner]/[repo]/events/pagination";
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
    const { sql, params: sqlParams } = repoEventsQuery(fullName, offset);
    const rows = await query<RepoEvent>(sql, sqlParams);

    const hasMore = rows.length > EVENTS_PAGE_SIZE;
    const events = rows.slice(0, EVENTS_PAGE_SIZE);

    return NextResponse.json({ events, hasMore });
  } catch (err) {
    return serverError("repo-events", err);
  }
}
