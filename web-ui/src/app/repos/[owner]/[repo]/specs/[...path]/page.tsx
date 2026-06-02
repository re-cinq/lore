export const dynamic = "force-dynamic";
import Link from 'next/link';
import { query, getRepoSchema } from '@/lib/db';
import { reassembleSpec, parseSpecTitle } from '@/lib/spec-summary';
import CoverageBar from '@/components/CoverageBar';
import { deriveCoverageFromMarkdown } from '@/lib/spec-coverage-derive';
import SpecDetails, { type StatementInfo } from '../SpecDetails';

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
  const schema = await getRepoSchema(fullName);

  const chunks = await query<SpecChunkRow>(
    `SELECT content, ingested_at FROM ${schema}.chunks
     WHERE content_type = 'spec' AND repo = $1 AND file_path = $2`,
    [fullName, filePath],
  );

  const specsLink = `/repos/${owner}/${repo}/specs`;

  if (chunks.length === 0) {
    return (
      <div>
        <div className="breadcrumb">
          <Link href={specsLink}>Specifications</Link> / {filePath}
        </div>
        <h1>Not Found</h1>
        <div className="empty-state">
          <p>No spec found at &quot;{filePath}&quot; for {fullName}.</p>
        </div>
      </div>
    );
  }

  const content = reassembleSpec(chunks);
  const title = parseSpecTitle(content, filePath);
  const { statements, counts } = deriveCoverageFromMarkdown(content);

  // The SpecDetails component's StatementInfo is structurally identical
  // to DerivedStatement; cast for the prop type.
  const propStatements: StatementInfo[] = statements;

  return (
    <div>
      <div className="breadcrumb">
        <Link href={specsLink}>Specifications</Link> / <strong>{title}</strong>
      </div>
      <h1>{title}</h1>
      <p className="meta" style={{ fontFamily: 'var(--font-mono)', marginTop: 0, marginBottom: 16 }}>{filePath}</p>
      <div style={{ marginBottom: 20 }}>
        <CoverageBar coverage={counts} size="md" />
      </div>
      <SpecDetails content={content} statements={propStatements} />
    </div>
  );
}
