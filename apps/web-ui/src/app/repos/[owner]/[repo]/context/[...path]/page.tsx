export const dynamic = "force-dynamic";
import { query, getRepoSchema } from '@/lib/db';
import ContextFileView, { type ContextFileChunk } from '../ContextFileView';

export default async function RepoContextFile({
  params,
}: {
  params: Promise<{ owner: string; repo: string; path: string[] }>;
}) {
  const { owner, repo, path } = await params;
  const fullName = `${owner}/${repo}`;
  const filePath = path.map(decodeURIComponent).join('/');

  const schema = await getRepoSchema(fullName);

  const chunks = await query<ContextFileChunk>(
    `SELECT id, content_type, content, metadata
     FROM ${schema}.chunks
     WHERE repo = $1 AND file_path = $2
     ORDER BY (metadata->>'chunk_index')::int NULLS LAST,
              (metadata->>'start_line')::int NULLS LAST,
              ingested_at`,
    [fullName, filePath],
  );

  return (
    <ContextFileView
      filePath={filePath}
      contextLink={`/repos/${owner}/${repo}/context`}
      groups={[{ repo: fullName, chunks }]}
    />
  );
}
