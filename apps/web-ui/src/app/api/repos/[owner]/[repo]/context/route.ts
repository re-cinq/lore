export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { previewBlock } from "@/lib/preview-block";
import { contentTypeOf } from "@/lib/content-types";
import { fetchRepoChunks } from "@/app/repos/[owner]/[repo]/context/context-data";
import { serverError } from "@/lib/api-error";
import type { RepoContextChunk } from "@/app/repos/[owner]/[repo]/context/RepoContextView";

// Load-more endpoint for the per-repo context list; session enforced upstream by withAuth (middleware.ts).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || undefined;
  const type = searchParams.get("type") || undefined;
  const offset = Math.max(
    0,
    parseInt(searchParams.get("offset") ?? "0", 10) || 0,
  );

  try {
    const page = await fetchRepoChunks(fullName, type, q, offset);
    const chunks = (page.chunks as unknown as RepoContextChunk[]).map((c) => ({
      ...c,
      content: previewBlock(c.content, contentTypeOf(c.content_type)),
    }));

    return NextResponse.json({ chunks, hasMore: page.hasMore });
  } catch (err) {
    return serverError("repo-context", err);
  }
}
