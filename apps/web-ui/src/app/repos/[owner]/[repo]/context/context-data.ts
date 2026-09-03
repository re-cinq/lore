import { getChunks } from "@/lib/api/chunks";
import { CONTEXT_PAGE_SIZE, type ContextChunkPage } from "./pagination";

/** Fetch one page of repo's context chunks; lore-api returns +1 row to compute hasMore without COUNT. */
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
