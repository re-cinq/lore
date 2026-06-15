export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { query, getRepoSchema } from "@/lib/db";
import { previewBlock } from "@/lib/preview-block";
import { CONTEXT_PAGE_SIZE, contextChunkQuery } from "@/app/repos/[owner]/[repo]/context/pagination";
import { serverError } from "@/lib/api-error";
import type { RepoContextChunk } from "@/app/repos/[owner]/[repo]/context/RepoContextView";

// Load-more endpoint for the per-repo context list. The first page is rendered
// server-side by page.tsx; this serves subsequent pages to the LoadMore client
// component. Session is enforced upstream by withAuth (middleware.ts).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || undefined;
  const type = searchParams.get("type") || undefined;
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);

  try {
    const schema = await getRepoSchema(fullName);
    const { sql, params: sqlParams } = contextChunkQuery(schema, fullName, type, q, offset);
    const rows = await query<RepoContextChunk>(sql, sqlParams);

    const hasMore = rows.length > CONTEXT_PAGE_SIZE;
    const chunks = rows.slice(0, CONTEXT_PAGE_SIZE).map((c) => ({
      ...c,
      content: previewBlock(c.content, c.content_type),
    }));

    return NextResponse.json({ chunks, hasMore });
  } catch (err) {
    return serverError("repo-context", err);
  }
}
