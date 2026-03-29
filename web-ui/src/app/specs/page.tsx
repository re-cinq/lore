export const dynamic = "force-dynamic";
import { query } from '@/lib/db';

interface Spec {
  file_path: string;
  content_type: string;
  created_at: string;
  excerpt: string;
}

export default async function SpecsPage() {
  const specs = await query<Spec>(`
    SELECT file_path, content_type, ingested_at as created_at,
           substring(content, 1, 200) as excerpt
    FROM org_shared.chunks
    WHERE content_type IN ('spec', 'doc')
      AND file_path LIKE 'specs/%'
    ORDER BY ingested_at DESC
    LIMIT 50
  `);

  return (
    <div>
      <h1>Specifications</h1>
      <p className="meta">Browse ingested specs from the context repository.</p>
      {specs.map((s, i) => (
        <div key={i} className="spec-card">
          <h3>{s.file_path}</h3>
          <span className="badge">{s.content_type}</span>
          <pre>{s.excerpt}...</pre>
        </div>
      ))}
      {specs.length === 0 && <p className="meta">No specs ingested yet.</p>}
    </div>
  );
}
