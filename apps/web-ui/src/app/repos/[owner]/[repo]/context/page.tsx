export const dynamic = "force-dynamic";
import { previewBlock } from "@/lib/preview-block";
import { contentTypeOf } from "@/lib/content-types";
import { fetchRepoChunks } from "./context-data";
import { getChunkTypes } from "@/lib/api/chunks";
import RepoContextView, { type RepoContextChunk } from "./RepoContextView";

export default async function RepoContext({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const { owner, repo } = await params;
  const { q, type } = await searchParams;
  const fullName = `${owner}/${repo}`;

  // Chip set is data-driven; unaffected by filter/search so chips never disappear
  const typeResult = await getChunkTypes(fullName);
  const types = typeResult.status === "ok" ? typeResult.data.types : [];

  // First page server-side; rest pages client-side via LoadMore
  const page = await fetchRepoChunks(fullName, type, q, 0);
  const hasMore = page.hasMore;
  const chunks = (page.chunks as unknown as RepoContextChunk[]).map((c) => ({
    ...c,
    content: previewBlock(c.content, contentTypeOf(c.content_type)),
  }));

  return (
    <RepoContextView
      owner={owner}
      repo={repo}
      type={type}
      q={q}
      types={types}
      chunks={chunks}
      hasMore={hasMore}
    />
  );
}
