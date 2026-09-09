import { getChunks } from "@/lib/api/chunks";
import { CONTEXT_PAGE_SIZE, type ContextChunkPage } from "./pagination";

/** Fetch one page of a repo's context chunks. */
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

  return toChunkPage(result.status === "ok" ? result.data.chunks : []);
}

/** lore-api returns one row past the page so `hasMore` needs no COUNT; that extra row is the answer, not part of the page. */
function toChunkPage(rows: unknown[]): ContextChunkPage {
  return {
    chunks: rows.slice(0, CONTEXT_PAGE_SIZE) as Record<string, unknown>[],
    hasMore: rows.length > CONTEXT_PAGE_SIZE,
  };
}
