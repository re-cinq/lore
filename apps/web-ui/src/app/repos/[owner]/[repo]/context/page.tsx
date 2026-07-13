export const dynamic = "force-dynamic";
import { query, getRepoSchema } from "@/lib/db";
import { previewBlock } from "@/lib/preview-block";
import { CONTEXT_PAGE_SIZE, contextChunkQuery } from "./pagination";
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

  const schema = await getRepoSchema(fullName);

  // The chip set is data-driven — only content types actually present, and
  // unaffected by the active filter/search so chips never disappear.
  const typeRows = await query<{ content_type: string }>(
    `SELECT DISTINCT content_type FROM ${schema}.chunks WHERE repo = $1`,
    [fullName],
  );
  const types = typeRows.map((r) => r.content_type).filter(Boolean);

  // Fetch one extra row past the page size to detect whether more pages exist
  // without a separate COUNT. The first page is rendered server-side; the rest
  // is paged in client-side via LoadMore against the context API route.
  const { sql, params: sqlParams } = contextChunkQuery(
    schema,
    fullName,
    type,
    q,
    0,
  );
  const rows = await query<RepoContextChunk>(sql, sqlParams);

  const hasMore = rows.length > CONTEXT_PAGE_SIZE;
  const chunks = rows.slice(0, CONTEXT_PAGE_SIZE).map((c) => ({
    ...c,
    content: previewBlock(c.content, c.content_type),
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
