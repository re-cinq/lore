export const dynamic = "force-dynamic";
import Link from 'next/link';
import { query } from '@/lib/db';

interface Spec {
  file_path: string;
  content_type: string;
  ingested_at: string;
  excerpt: string;
}

interface ContentTypeCount {
  content_type: string;
  count: number;
}

const CONTENT_TYPE_BADGE: Record<string, string> = {
  spec: 'badge badge-blue',
  doc: 'badge badge-green',
  adr: 'badge badge-yellow',
  claude_md: 'badge badge-purple',
};

function badgeClass(contentType: string): string {
  return CONTENT_TYPE_BADGE[contentType] || 'badge badge-gray';
}

export default async function SpecsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;

  // Get available content types for filter buttons
  const contentTypes = await query<ContentTypeCount>(`
    SELECT content_type, count(*)::int as count
    FROM org_shared.chunks
    WHERE content_type IS NOT NULL
    GROUP BY content_type
    ORDER BY count DESC
  `);

  // Build query with optional content_type filter
  const conditions: string[] = [];
  const params: string[] = [];

  if (type && type.trim()) {
    conditions.push(`content_type = $1`);
    params.push(type.trim());
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const specs = await query<Spec>(`
    SELECT file_path, content_type, ingested_at,
           substring(content, 1, 200) as excerpt
    FROM org_shared.chunks
    ${whereClause}
    ORDER BY ingested_at DESC
    LIMIT 50
  `, params);

  return (
    <div>
      <h1>Org Context &amp; Specifications</h1>
      <div style={{ background: 'var(--bg-muted, #1a1a2e)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
        <p className="meta" style={{ margin: 0 }}>
          This is the global view across all repos. For repo-specific specs, visit{' '}
          <Link href="/">Repositories</Link> and select a repo.
        </p>
      </div>
      <p className="meta" style={{ marginBottom: 16 }}>
        Browse ingested specs, ADRs, CLAUDE.md, and other org context from the context repository.
      </p>

      <div className="filter-buttons">
        <Link href="/specs" className={!type ? 'active' : ''}>
          All
        </Link>
        {contentTypes.map(ct => (
          <Link
            key={ct.content_type}
            href={`/specs?type=${encodeURIComponent(ct.content_type)}`}
            className={type === ct.content_type ? 'active' : ''}
          >
            {ct.content_type} ({ct.count})
          </Link>
        ))}
      </div>

      <p className="meta" style={{ marginBottom: 16 }}>
        {specs.length} chunk{specs.length !== 1 ? 's' : ''}{type ? ` of type "${type}"` : ''}
      </p>

      {specs.map((s, i) => (
        <div key={i} className="spec-card">
          <h3>
            <Link href={`/specs/${encodeURIComponent(s.file_path)}`}>
              {s.file_path}
            </Link>
          </h3>
          <span className={badgeClass(s.content_type)}>{s.content_type}</span>
          <span className="meta" style={{ marginLeft: 8 }}>
            {new Date(s.ingested_at).toLocaleString()}
          </span>
          <pre>{s.excerpt}...</pre>
        </div>
      ))}
      {specs.length === 0 && (
        <div className="empty-state">
          <p>No content ingested yet{type ? ` for type "${type}"` : ''}.</p>
        </div>
      )}
    </div>
  );
}
