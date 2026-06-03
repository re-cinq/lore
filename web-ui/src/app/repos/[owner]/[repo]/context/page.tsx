export const dynamic = "force-dynamic";
import { query, getRepoSchema } from '@/lib/db';
import RepoContextView, { type RepoContextChunk } from './RepoContextView';

export default async function RepoContext({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const schema = await getRepoSchema(fullName);

  // Get context chunks that belong to this repo
  const chunks = await query<RepoContextChunk>(
    `SELECT id, file_path, content_type, substring(content, 1, 500) as content, ingested_at
     FROM ${schema}.chunks
     WHERE repo = $1
     ORDER BY content_type, file_path`,
    [fullName]
  );

  const types = [...new Set(chunks.map((c) => c.content_type))];

  return <RepoContextView types={types} chunks={chunks} />;
}
