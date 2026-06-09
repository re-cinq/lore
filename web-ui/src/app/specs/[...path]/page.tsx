export const dynamic = "force-dynamic";
import Link from 'next/link';
import { fetchAllSpecs, fetchTraceDocument, type TraceDocument } from '@/lib/trace-api';
import TraceDocumentView from '@/app/repos/[owner]/[repo]/specs/[...path]/TraceDocumentView';

export default async function SpecDetailPage({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const filePath = path.map(decodeURIComponent).join('/');

  // Which repos hold this spec path in the graph, then assemble each from the graph.
  const repos = (await fetchAllSpecs()).filter((s) => s.filePath === filePath).map((s) => s.repo);
  const docs = (await Promise.all(repos.map(async (repo) => ({ repo, doc: await fetchTraceDocument(repo, filePath) }))))
    .filter((entry): entry is { repo: string; doc: TraceDocument } => entry.doc !== null && entry.doc.statements.length > 0);

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/specs">Specifications</Link> / {filePath}
      </div>
      {docs.length === 0 ? (
        <div className="empty-state">
          <p>No graph data for &quot;{filePath}&quot;. Build the repo&apos;s graph and run the ingest-specs task.</p>
        </div>
      ) : (
        docs.map(({ repo, doc }) => (
          <div key={repo} style={{ marginBottom: 24 }}>
            <p className="meta">
              repo: {repo} · <Link href={`/repos/${repo}/specs/${encodeURIComponent(filePath)}`}>view in repo →</Link>
            </p>
            <TraceDocumentView repo={repo} doc={doc} />
          </div>
        ))
      )}
    </div>
  );
}
