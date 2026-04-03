export const dynamic = "force-dynamic";
import { query } from '@/lib/db';

export default async function RepoSpecs({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const specs = await query(
    `SELECT id, file_path, substring(content, 1, 400) as content, ingested_at
     FROM org_shared.chunks
     WHERE content_type = 'spec' AND repo = $1
     ORDER BY ingested_at DESC LIMIT 30`,
    [fullName]
  );

  return (
    <div>
      <h2>Specifications</h2>
      {specs.map((s: any) => (
        <div key={s.id} className="spec-card">
          <h3>{s.file_path}</h3>
          <span className="meta">{new Date(s.ingested_at).toLocaleString()}</span>
          <pre>{s.content}...</pre>
        </div>
      ))}
      {specs.length === 0 && <p className="meta">No specs found for this repo.</p>}
    </div>
  );
}
