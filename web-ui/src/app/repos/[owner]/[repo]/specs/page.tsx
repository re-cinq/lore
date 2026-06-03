export const dynamic = "force-dynamic";
import { query, getRepoSchema, getRepoSchemaAndTeam } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { validateSpecPath } from '@/lib/spec-path';
import { reassembleSpec, parseSpecTitle, extractSummary } from '@/lib/spec-summary';
import { deriveCoverageFromMarkdown } from '@/lib/spec-coverage-derive';
import { type SpecCardData } from './SpecCard';
import RepoSpecsView from './RepoSpecsView';

async function addSpec(formData: FormData) {
  'use server';
  const owner = formData.get('owner') as string;
  const repo = formData.get('repo') as string;
  const fullName = `${owner}/${repo}`;
  const { valid, path: filePath } = validateSpecPath(formData.get('file_path') as string);
  const content = (formData.get('content') as string || '').trim();
  if (!valid || !content) return;

  const repoData = await getRepoSchemaAndTeam(fullName);
  if (!repoData) return;

  const { schema, team } = repoData;
  await query(
    `INSERT INTO ${schema}.chunks (content, content_type, team, repo, file_path, metadata)
     VALUES ($1, 'spec', $2, $3, $4, $5)`,
    [content, team || 'org', fullName, filePath, JSON.stringify({ created_by: 'ui' })]
  );

  revalidatePath(`/repos/${owner}/${repo}/specs`);
}

export default async function RepoSpecs({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const schema = await getRepoSchema(fullName);

  const specChunks = await query<{ file_path: string; content: string; ingested_at: string }>(
    `SELECT file_path, content, ingested_at
     FROM ${schema}.chunks
     WHERE content_type = 'spec' AND repo = $1 AND file_path LIKE '%.md'`,
    [fullName]
  );

  const chunksByPath = new Map<string, { content: string; ingested_at: string }[]>();
  for (const chunk of specChunks) {
    const list = chunksByPath.get(chunk.file_path) ?? [];
    list.push(chunk);
    chunksByPath.set(chunk.file_path, list);
  }

  const specs: SpecCardData[] = [...chunksByPath.entries()]
    .map(([spec_path, chunks]) => {
      const content = reassembleSpec(chunks);
      const { counts } = deriveCoverageFromMarkdown(content);
      return {
        spec_path,
        title: parseSpecTitle(content, spec_path),
        summary: extractSummary(content),
        coverage: counts,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  return <RepoSpecsView owner={owner} repo={repo} specs={specs} addSpecAction={addSpec} />;
}
