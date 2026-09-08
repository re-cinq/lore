export const dynamic = "force-dynamic";
import { previewBlock } from "@/lib/preview-block";
import { contentTypeOf } from "@/lib/content-types";
import { fetchRepoChunks } from "./context-data";
import { getChunkTypes } from "@/lib/api/chunks";
import type { ContextChunkPage } from "./pagination";
import RepoContextView, { type RepoContextChunk } from "./RepoContextView";

interface RepoContextPageProps {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ q?: string; type?: string }>;
}

export default async function RepoContext(props: RepoContextPageProps) {
  const { owner, repo } = await props.params;
  const { q, type } = await props.searchParams;
  const fullName = `${owner}/${repo}`;
  const types = await fetchChunkTypes(fullName);
  const page = await fetchRepoChunks(fullName, type, q, 0);

  return (
    <RepoContextView
      owner={owner}
      repo={repo}
      type={type}
      q={q}
      types={types}
      chunks={previewChunks(page.chunks)}
      hasMore={page.hasMore}
    />
  );
}

/** Chip set is data-driven; unaffected by filter/search so chips never disappear. */
async function fetchChunkTypes(fullName: string): Promise<string[]> {
  const result = await getChunkTypes(fullName);

  return result.status === "ok" ? result.data.types : [];
}

/** First page server-side; the rest page in client-side via LoadMore. */
function previewChunks(rows: ContextChunkPage["chunks"]): RepoContextChunk[] {
  return (rows as unknown as RepoContextChunk[]).map((c) => ({
    ...c,
    content: previewBlock(c.content, contentTypeOf(c.content_type)),
  }));
}
