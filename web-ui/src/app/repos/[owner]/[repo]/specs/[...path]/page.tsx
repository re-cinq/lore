export const dynamic = "force-dynamic";
import Link from 'next/link';
import { query, queryAllowMissing, getRepoSchema } from '@/lib/db';
import { reassembleSpec, parseSpecTitle } from '@/lib/spec-summary';
import SpecDetails, { type TestLink } from '../SpecDetails';

interface SpecChunkRow {
  content: string;
  ingested_at: string;
}

interface LinkRow {
  test_name: string;
  test_file: string;
  test_line: number | null;
  symbol: string | null;
  match_kind: string;
  rationale: string;
}

function blobUrl(repo: string, filePath: string, line: number | null): string {
  const base = `https://github.com/${repo}/blob/HEAD/${filePath}`;
  return line ? `${base}#L${line}` : base;
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

  const links = await queryAllowMissing<LinkRow>(
    `SELECT test_name, test_file, test_line, symbol, match_kind, rationale
     FROM ${schema}.spec_test_links
     WHERE repo = $1 AND spec_path = $2
     ORDER BY test_file, test_line NULLS LAST`,
    [fullName, filePath],
  );

  const content = reassembleSpec(chunks);
  const title = parseSpecTitle(content, filePath);
  const tests: TestLink[] = links.map((link) => ({
    name: link.test_name,
    file_path: link.test_file,
    line: link.test_line,
    symbol: link.symbol,
    match_kind: link.match_kind,
    rationale: link.rationale,
    url: blobUrl(fullName, link.test_file, link.test_line),
  }));

  return (
    <div>
      <div className="breadcrumb">
        <Link href={specsLink}>Specifications</Link> / <strong>{title}</strong>
      </div>
      <h1>{title}</h1>
      <p className="meta" style={{ fontFamily: 'var(--font-mono)', marginTop: 0, marginBottom: 16 }}>{filePath}</p>
      <SpecDetails content={content} tests={tests} />
    </div>
  );
}
