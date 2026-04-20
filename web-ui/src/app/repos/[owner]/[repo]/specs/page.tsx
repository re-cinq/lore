export const dynamic = "force-dynamic";
import Link from 'next/link';
import { query, getRepoSchema } from '@/lib/db';

export default async function RepoSpecs({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const schema = await getRepoSchema(fullName);

  const specs = await query(
    `SELECT id, file_path, substring(content, 1, 200) as excerpt, ingested_at
     FROM ${schema}.chunks
     WHERE content_type = 'spec' AND repo = $1
     ORDER BY ingested_at DESC LIMIT 50`,
    [fullName]
  );

  return (
    <div>
      <h2>Specifications</h2>
      <p className="meta" style={{ marginBottom: 16 }}>
        Specs are ingested automatically from the repository. To add a spec, commit it under{' '}
        <code>specs/</code> and wait for the next ingestion run.
      </p>

      {specs.map((s: any) => (
        <div key={s.id} className="spec-card">
          <h3>
            <Link href={`/specs/${encodeURIComponent(s.file_path)}`}>
              {s.file_path}
            </Link>
          </h3>
          <span className="badge badge-blue">spec</span>
          <span className="meta" style={{ marginLeft: 8 }}>
            {new Date(s.ingested_at).toLocaleString()}
          </span>
          <pre>{s.excerpt}...</pre>
        </div>
      ))}
      {specs.length === 0 && (
        <div className="empty-state">
          <p>No specs ingested yet. Specs will appear after the next ingestion run.</p>
        </div>
      )}
    </div>
  );
}
