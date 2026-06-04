export const dynamic = "force-dynamic";
import { query, getRepoSchema } from '@/lib/db';
import RepoContextView, { type RepoContextChunk } from './RepoContextView';

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

  const chunks = await query<RepoContextChunk>(
    `SELECT id, file_path, content_type, metadata,
            substring(content, 1, 500) as content, ingested_at
     FROM ${schema}.chunks
     WHERE repo = $1
       AND ($2::text IS NULL OR content_type = $2)
       AND ($3::text IS NULL OR search_tsv @@ websearch_to_tsquery('english', $3))
     ORDER BY
       CASE WHEN $3::text IS NULL THEN 0
            ELSE ts_rank(search_tsv, websearch_to_tsquery('english', $3)) END DESC,
       content_type, file_path`,
    [fullName, type || null, q || null],
  );

  return (
    <RepoContextView owner={owner} repo={repo} type={type} q={q} types={types} chunks={chunks} />
  );
}
