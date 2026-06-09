export const dynamic = "force-dynamic";
import Link from 'next/link';
import { fetchTraceDocument, fetchTraceSource } from '@/lib/trace-api';
import { toStatementInfo } from '@/lib/trace-statement-info';
import SpecDocument from './SpecDocument';

export default async function RepoSpecDetail({
  params,
}: {
  params: Promise<{ owner: string; repo: string; path: string[] }>;
}) {
  const { owner, repo, path } = await params;
  const fullName = `${owner}/${repo}`;
  const filePath = path.map(decodeURIComponent).join('/');
  const specsLink = `/repos/${owner}/${repo}/specs`;

  // Graph is the source of truth: the byte-exact markdown SOURCE renders as a
  // normal document (framed per section), and the statement overlay (tested
  // underline + hover node details) comes from the structured document.
  const [source, doc] = await Promise.all([
    fetchTraceSource(fullName, filePath),
    fetchTraceDocument(fullName, filePath),
  ]);
  const statements = doc ? toStatementInfo(doc.statements) : [];

  return (
    <div>
      <p className="meta" style={{ marginBottom: 12 }}>
        <Link href={specsLink}>← Specifications</Link>
      </p>
      {source ? (
        <SpecDocument repo={fullName} content={source} statements={statements} />
      ) : (
        <p style={{ color: 'var(--text-muted)' }}>
          No graph data for <code>{filePath}</code>. Build the graph from the <strong>Graph</strong> tab and run the{' '}
          <code>ingest-*</code> tasks, then refresh.
        </p>
      )}
    </div>
  );
}
