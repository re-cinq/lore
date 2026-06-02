export const dynamic = "force-dynamic";
import Link from 'next/link';
import { query, queryAllowMissing, getRepoSchema } from '@/lib/db';
import { reassembleSpec, parseSpecTitle } from '@/lib/spec-summary';
import CoverageBar, { type CoverageCounts } from '@/components/CoverageBar';
import SpecDetails, { type TestLink, type StatementInfo } from '../SpecDetails';

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
  statement_ordinal: number | null;
  statement_text: string | null;
  match_score: number | null;
}

interface StatementRow {
  ordinal: number;
  text: string;
  kind: string;
  testability: string;
  category: string | null;
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
    `SELECT test_name, test_file, test_line, symbol, match_kind, rationale,
            statement_ordinal, statement_text, match_score
     FROM ${schema}.spec_test_links
     WHERE repo = $1 AND spec_path = $2
     ORDER BY test_file, test_line NULLS LAST`,
    [fullName, filePath],
  );
  const runRows = await queryAllowMissing<{ run_at: string; linked_by: string | null }>(
    `SELECT run_at, linked_by FROM ${schema}.spec_coverage_runs
     WHERE repo = $1 AND spec_path = $2`,
    [fullName, filePath],
  );
  const run = runRows[0] ?? null;
  const statementRows = await queryAllowMissing<StatementRow>(
    `SELECT ordinal, text, kind, testability, category
     FROM ${schema}.spec_statements
     WHERE repo = $1 AND spec_path = $2
     ORDER BY ordinal`,
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
    statement_ordinal: link.statement_ordinal,
    match_score: link.match_score,
    url: blobUrl(fullName, link.test_file, link.test_line),
  }));
  const statements: StatementInfo[] = statementRows.map((r) => ({
    ordinal: r.ordinal,
    text: r.text,
    kind: r.kind,
    testability: r.testability,
    category: r.category,
  }));

  const coveredOrdinals = new Set(
    links.map((l) => l.statement_ordinal).filter((o): o is number => o !== null),
  );
  const testableCount = statements.filter((s) => s.testability === 'testable').length;
  const untestableCount = statements.filter((s) => s.testability === 'untestable').length;
  const coveredCount = statements.filter(
    (s) => s.testability === 'testable' && coveredOrdinals.has(s.ordinal),
  ).length;
  const coverage: CoverageCounts = {
    testable: testableCount,
    covered: coveredCount,
    untestable: untestableCount,
  };

  return (
    <div>
      <div className="breadcrumb">
        <Link href={specsLink}>Specifications</Link> / <strong>{title}</strong>
      </div>
      <h1>{title}</h1>
      <p className="meta" style={{ fontFamily: 'var(--font-mono)', marginTop: 0, marginBottom: 16 }}>{filePath}</p>
      <div style={{ marginBottom: 20 }}>
        <CoverageBar coverage={coverage} size="md" />
        {run?.linked_by?.startsWith('local:') && (
          <div className="meta" style={{ marginTop: 6, fontSize: 'var(--fs-xs)' }}>
            linked by {run.linked_by.slice('local:'.length)} (local) at{' '}
            {new Date(run.run_at).toLocaleString()}
          </div>
        )}
      </div>
      <SpecDetails content={content} tests={tests} statements={statements} />
    </div>
  );
}
