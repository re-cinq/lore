export const dynamic = "force-dynamic";
import Link from 'next/link';
import { query } from '@/lib/db';

interface ChunkDetail {
  id: string;
  file_path: string;
  content_type: string;
  content: string;
  team: string | null;
  repo: string | null;
  author: string | null;
  ingested_at: string;
  metadata: any;
}

export default async function SpecDetailPage({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const filePath = path.map(decodeURIComponent).join('/');

  const chunks = await query<ChunkDetail>(`
    SELECT id, file_path, content_type, content, team, repo, author, ingested_at, metadata
    FROM org_shared.chunks
    WHERE file_path = $1
    ORDER BY ingested_at DESC
  `, [filePath]);

  if (chunks.length === 0) {
    return (
      <div>
        <div className="breadcrumb">
          <Link href="/specs">Context</Link> / {filePath}
        </div>
        <h1>Not Found</h1>
        <div className="empty-state">
          <p>No content found for path &quot;{filePath}&quot;.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/specs">Context</Link> / <strong>{filePath}</strong>
      </div>

      {chunks.map((chunk, i) => (
        <div key={chunk.id}>
          {i === 0 && <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: 16 }}>{chunk.file_path}</h1>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <span className="badge badge-blue">{chunk.content_type}</span>
            {chunk.team && <span className="meta">team: {chunk.team}</span>}
            {chunk.repo && <span className="meta">repo: {chunk.repo}</span>}
            {chunk.author && <span className="meta">author: {chunk.author}</span>}
            <span className="meta">ingested: {new Date(chunk.ingested_at).toLocaleString()}</span>
          </div>

          <div className="content-viewer">
            <pre>{chunk.content}</pre>
          </div>

          {chunk.metadata && (
            <details style={{ marginTop: 12 }}>
              <summary className="meta" style={{ cursor: 'pointer' }}>Metadata</summary>
              <pre style={{ marginTop: 8, fontSize: 11 }}>{JSON.stringify(chunk.metadata, null, 2)}</pre>
            </details>
          )}

          {i < chunks.length - 1 && (
            <hr style={{ border: 'none', borderTop: '1px solid #222', margin: '24px 0' }} />
          )}
        </div>
      ))}

      {chunks.length > 1 && (
        <p className="meta" style={{ marginTop: 16 }}>
          {chunks.length} chunk{chunks.length !== 1 ? 's' : ''} for this file path.
        </p>
      )}
    </div>
  );
}
