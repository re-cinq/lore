import { getChunks } from "@/lib/api/chunks";
import { CONTEXT_PAGE_SIZE, type ContextChunkPage } from "./pagination";

/**
 * A page of one repo's context chunks, shared by the server page (offset 0) and
 * the Load-more API route. lore-api returns one row past the page size, so
 * `hasMore` needs no separate COUNT.
 */
export async function fetchRepoChunks(
  repo: string,
  type: string | undefined,
  q: string | undefined,
  offset: number,
): Promise<ContextChunkPage> {
  const result = await getChunks({
    repo,
    type,
    q,
    limit: CONTEXT_PAGE_SIZE,
    offset,
  });
  const rows = result.status === "ok" ? result.data.chunks : [];

  return {
    chunks: rows.slice(0, CONTEXT_PAGE_SIZE) as unknown as Record<
      string,
      unknown
    >[],
    hasMore: rows.length > CONTEXT_PAGE_SIZE,
  };
}
