export const dynamic = "force-dynamic";
import { query, getRepoSchema } from '@/lib/db';
import HelpPopover from '@/components/HelpPopover';

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
      <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
        <h2 style={{margin:0}}>Context</h2>
        <HelpPopover label="How context is used">
          <p>Context is everything Lore has ingested about this repo — conventions, ADRs, specs, and code — stored as embedded chunks.</p>
          <ul>
            <li>Agents load it on turn 1 of every task via <code>assemble_context</code>, and search it with <code>search_context</code>.</li>
            <li>It is refreshed by nightly ingestion; a repo not ingested in over 7 days is flagged <strong>stale</strong>.</li>
            <li>Higher-signal chunks (incidents, conflicts, recent facts) are surfaced first within the token budget.</li>
          </ul>
        </HelpPopover>
      </div>
      <p className="meta" style={{marginTop:'6px', marginBottom:'12px'}}>
        Conventions, ADRs, specs, and code ingested from this repo that agents use as context.
      </p>
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
