export const dynamic = "force-dynamic";
import { query, queryAllowMissing, getRepoSchema, getRepoSchemaAndTeam } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import HelpPopover from '@/components/HelpPopover';
import { validateSpecPath } from '@/lib/spec-path';
import { reassembleSpec, parseSpecTitle, extractSummary } from '@/lib/spec-summary';
import SpecCard, { type SpecCardData } from './SpecCard';

async function addSpec(formData: FormData) {
  'use server';
  const owner = formData.get('owner') as string;
  const repo = formData.get('repo') as string;
  const fullName = `${owner}/${repo}`;
  const { valid, path: filePath } = validateSpecPath(formData.get('file_path') as string);
  const content = (formData.get('content') as string || '').trim();
  if (!valid || !content) return;

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

  const specChunks = await query<{ file_path: string; content: string; ingested_at: string }>(
    `SELECT file_path, content, ingested_at
     FROM ${schema}.chunks
     WHERE content_type = 'spec' AND repo = $1`,
    [fullName]
  );

  const runRows = await queryAllowMissing<{ spec_path: string; run_at: string; linked_by: string | null }>(
    `SELECT spec_path, run_at, linked_by
     FROM ${schema}.spec_coverage_runs
     WHERE repo = $1`,
    [fullName]
  );
  const runByPath = new Map<string, { run_at: string; linked_by: string | null }>();
  for (const row of runRows) runByPath.set(row.spec_path, { run_at: row.run_at, linked_by: row.linked_by });

  const linkRows = await queryAllowMissing<{ spec_path: string; statement_ordinal: number | null }>(
    `SELECT spec_path, statement_ordinal
     FROM ${schema}.spec_test_links
     WHERE repo = $1`,
    [fullName]
  );
  const linksByPath = new Map<string, (number | null)[]>();
  const linkCountByPath = new Map<string, number>();
  for (const row of linkRows) {
    const list = linksByPath.get(row.spec_path) ?? [];
    list.push(row.statement_ordinal);
    linksByPath.set(row.spec_path, list);
    linkCountByPath.set(row.spec_path, (linkCountByPath.get(row.spec_path) ?? 0) + 1);
  }

  const statementRows = await queryAllowMissing<{
    spec_path: string;
    ordinal: number;
    testability: string;
  }>(
    `SELECT spec_path, ordinal, testability
     FROM ${schema}.spec_statements
     WHERE repo = $1`,
    [fullName]
  );
  const statementsByPath = new Map<string, { ordinal: number; testability: string }[]>();
  for (const row of statementRows) {
    const list = statementsByPath.get(row.spec_path) ?? [];
    list.push({ ordinal: row.ordinal, testability: row.testability });
    statementsByPath.set(row.spec_path, list);
  }

  const chunksByPath = new Map<string, { content: string; ingested_at: string }[]>();
  for (const chunk of specChunks) {
    const list = chunksByPath.get(chunk.file_path) ?? [];
    list.push(chunk);
    chunksByPath.set(chunk.file_path, list);
  }

  const specs: SpecCardData[] = [...chunksByPath.entries()]
    .map(([spec_path, chunks]) => {
      const content = reassembleSpec(chunks);
      const statements = statementsByPath.get(spec_path) ?? [];
      const coveredOrdinals = new Set(
        (linksByPath.get(spec_path) ?? []).filter((o): o is number => o !== null)
      );
      const testable = statements.filter((s) => s.testability === 'testable').length;
      const untestable = statements.filter((s) => s.testability === 'untestable').length;
      const covered = statements.filter(
        (s) => s.testability === 'testable' && coveredOrdinals.has(s.ordinal)
      ).length;
      const run = runByPath.get(spec_path) ?? null;
      return {
        spec_path,
        title: parseSpecTitle(content, spec_path),
        summary: extractSummary(content),
        coverage: { testable, covered, untestable },
        test_count: linkCountByPath.get(spec_path) ?? 0,
        last_linked_at: run?.run_at ?? null,
        last_linked_by: run?.linked_by ?? null,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <h2 style={{ margin: 0 }}>Specifications</h2>
        <HelpPopover label="How specs are used">
          <p>Specs are stored as context chunks for this repo and become part of the context Lore assembles for agents:</p>
          <ul>
            <li><strong>feature-request</strong> tasks turn a plain-language intent into a spec.</li>
            <li><strong>implementation</strong> and <strong>review</strong> tasks read the spec to build and check against the intended contract.</li>
            <li>They surface in <code>assemble_context</code> and <code>search_context</code> alongside ADRs and conventions.</li>
          </ul>
          <p className="meta">Note: a spec added here is saved and listed below immediately, but is only picked up by semantic search after the next ingestion generates its embeddings.</p>
        </HelpPopover>
      </div>
      <p className="meta" style={{marginTop:'6px', marginBottom:'16px'}}>
        Specifications and design docs for this repo. Add your own or browse what&apos;s been ingested.
      </p>

      <form action={addSpec} className="task-form" style={{ maxWidth: '600px', marginBottom: '2rem' }}>
        <input type="hidden" name="owner" value={owner} />
        <input type="hidden" name="repo" value={repo} />

        <label htmlFor="spec-path">Spec path</label>
        <input
          id="spec-path"
          name="file_path"
          required
          placeholder="specs/my-feature/spec.md"
          pattern="([\w.-]+/)*[\w.-]+\.md"
          title="Relative path ending in .md, e.g. specs/my-feature/spec.md (no leading slash)"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          style={{ fontFamily: 'var(--font-mono)' }}
        />
        <span className="meta" style={{ fontSize: 'var(--fs-xs)' }}>
          Relative path within the repo, ending in <code>.md</code> — e.g. <code>specs/my-feature/spec.md</code>. No leading slash.
        </span>

        <label>Content</label>
        <textarea name="content" required rows={8} placeholder="Describe the specification..." style={{ width: '100%', fontFamily: 'var(--font-mono)', resize: 'vertical' }} />

        <button type="submit">Add Spec</button>
      </form>

      {specs.map((spec) => (
        <SpecCard key={spec.spec_path} owner={owner} repo={repo} spec={spec} />
      ))}
      {specs.length === 0 && <p className="meta">No specs found for this repo.</p>}
    </div>
  );
}
