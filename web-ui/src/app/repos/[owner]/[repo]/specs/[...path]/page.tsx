export const dynamic = "force-dynamic";
import { query, getRepoSchema } from '@/lib/db';
import { reassembleSpec, parseSpecTitle } from '@/lib/spec-summary';
import { deriveCoverageFromMarkdown } from '@/lib/spec-coverage-derive';
import SpecDetailView, { type SpecDetailData } from './SpecDetailView';

interface SpecChunkRow {
  content: string;
  ingested_at: string;
}

export default async function RepoSpecDetail({
  params,
}: {
  params: Promise<{ owner: string; repo: string; path: string[] }>;
}) {
  const { owner, repo, path } = await params;
  const fullName = `${owner}/${repo}`;
  const filePath = path.map(decodeURIComponent).join('/');
  const specsLink = `/repos/${owner}/${repo}/specs`;
  const schema = await getRepoSchema(fullName);

  const chunks = await query<SpecChunkRow>(
    `SELECT content, ingested_at FROM ${schema}.chunks
     WHERE content_type = 'spec' AND repo = $1 AND file_path = $2`,
    [fullName, filePath],
  );

  let spec: SpecDetailData | null = null;
  if (chunks.length > 0) {
    const content = reassembleSpec(chunks);
    const { statements, counts } = deriveCoverageFromMarkdown(content);
    spec = { title: parseSpecTitle(content, filePath), content, statements, counts };
  }

  return <SpecDetailView fullName={fullName} filePath={filePath} specsLink={specsLink} spec={spec} />;
}
