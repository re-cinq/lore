export const dynamic = "force-dynamic";
import Link from 'next/link';
import { fetchTraceDocument } from '@/lib/trace-api';
import TraceDocumentView from './TraceDocumentView';

export default async function RepoSpecDetail({
  params,
}: {
  params: Promise<{ owner: string; repo: string; path: string[] }>;
}) {
  const { owner, repo, path } = await params;
  const fullName = `${owner}/${repo}`;
  const filePath = path.map(decodeURIComponent).join('/');
  const specsLink = `/repos/${owner}/${repo}/specs`;

  // The spec-traceability graph is the source of truth — reconstruct the
  // document (ordered sections + statements + links + coverage) from it.
  const doc = await fetchTraceDocument(fullName, filePath);

  return (
    <div>
      <p className="meta" style={{ marginBottom: 12 }}>
        <Link href={specsLink}>← Specifications</Link>
      </p>
      {doc && doc.statements.length > 0 ? (
        <TraceDocumentView repo={fullName} doc={doc} />
      ) : (
        <p style={{ color: 'var(--text-muted)' }}>
          No graph data for <code>{filePath}</code>. Build the graph from the <strong>Graph</strong> tab and run the{' '}
          <code>ingest-*</code> tasks, then refresh.
        </p>
      )}
    </div>
  );
}
