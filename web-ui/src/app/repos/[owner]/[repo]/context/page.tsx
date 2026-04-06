export const dynamic = "force-dynamic";
import { query, getRepoSchema } from '@/lib/db';

export default async function RepoContext({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const schema = await getRepoSchema(fullName);

  // Get context chunks that belong to this repo
  const chunks = await query(
    `SELECT id, file_path, content_type, substring(content, 1, 500) as content, ingested_at
     FROM ${schema}.chunks
     WHERE repo = $1
     ORDER BY content_type, file_path`,
    [fullName]
  );

  const types = [...new Set(chunks.map((c: any) => c.content_type))];

  return (
    <div>
      <h2>Context</h2>
      <p className="meta">{chunks.length} chunks ingested</p>
      {types.map(type => (
        <div key={type}>
          <h3 style={{marginTop:'16px', textTransform:'capitalize'}}>{type}s</h3>
          {chunks.filter((c: any) => c.content_type === type).map((c: any) => (
            <div key={c.id} className="spec-card">
              <h3>{c.file_path}</h3>
              <span className="badge">{c.content_type}</span>
              <pre>{c.content}...</pre>
            </div>
          ))}
        </div>
      ))}
      {chunks.length === 0 && <p className="meta">No context ingested yet. Context will appear after the nightly ingestion runs.</p>}
    </div>
  );
}
