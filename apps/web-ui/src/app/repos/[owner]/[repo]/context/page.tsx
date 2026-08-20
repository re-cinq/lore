export const dynamic = "force-dynamic";
import { previewBlock } from "@/lib/preview-block";
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

  // The chip set is data-driven — only content types actually present, and
  // unaffected by the active filter/search so chips never disappear.
  const typeResult = await getChunkTypes(fullName);
  const types = typeResult.status === "ok" ? typeResult.data.types : [];

  // The first page renders server-side; the rest pages in client-side via
  // LoadMore against the context API route.
  const page = await fetchRepoChunks(fullName, type, q, 0);
  const hasMore = page.hasMore;
  const chunks = (page.chunks as unknown as RepoContextChunk[]).map((c) => ({
    ...c,
    content: previewBlock(c.content, c.content_type ?? ""),
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
