export const dynamic = "force-dynamic";
import { query, getRepoSchema, getRepoSchemaAndTeam } from '@/lib/db';
import { revalidatePath } from 'next/cache';

async function addSpec(formData: FormData) {
  'use server';
  const owner = formData.get('owner') as string;
  const repo = formData.get('repo') as string;
  const fullName = `${owner}/${repo}`;
  const filePath = (formData.get('file_path') as string || '').trim();
  const content = (formData.get('content') as string || '').trim();
  if (!filePath || !content) return;

  const repoData = await getRepoSchemaAndTeam(fullName);
  if (!repoData) return;

  const { schema, team } = repoData;
  await query(
    `INSERT INTO ${schema}.chunks (content, content_type, team, repo, file_path, metadata)
     VALUES ($1, 'spec', $2, $3, $4, $5)`,
    [content, team || 'org', fullName, filePath, JSON.stringify({ created_by: 'ui' })]
  );

  revalidatePath(`/repos/${owner}/${repo}/specs`);
}

export default async function RepoSpecs({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const schema = await getRepoSchema(fullName);

  const specs = await query(
    `SELECT id, file_path, substring(content, 1, 400) as content, ingested_at
     FROM ${schema}.chunks
     WHERE content_type = 'spec' AND repo = $1
     ORDER BY ingested_at DESC LIMIT 30`,
    [fullName]
  );

  return (
    <div>
      <h2>Specifications</h2>

      <form action={addSpec} className="task-form" style={{ maxWidth: '600px', marginBottom: '2rem' }}>
        <input type="hidden" name="owner" value={owner} />
        <input type="hidden" name="repo" value={repo} />

        <label>Spec path (e.g. specs/my-feature/spec.md)</label>
        <input name="file_path" required placeholder="specs/my-feature/spec.md" />

        <label>Content</label>
        <textarea name="content" required rows={8} placeholder="Describe the specification..." style={{ width: '100%', fontFamily: 'monospace', resize: 'vertical' }} />

        <button type="submit">Add Spec</button>
      </form>

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
