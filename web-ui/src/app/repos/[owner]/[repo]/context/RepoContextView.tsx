import HelpPopover from '@/components/HelpPopover';

export interface RepoContextChunk {
  id: string;
  file_path: string;
  content_type: string;
  content: string;
  ingested_at: string;
}

export interface RepoContextViewProps {
  /** Distinct content_types in DB sort order; one section heading per type. */
  types: string[];
  chunks: RepoContextChunk[];
}

/**
 * Presentational view for a single repo's ingested context. Pure render —
 * the container (`page.tsx`) runs the schema-scoped query and derives the
 * distinct `types` list; this component groups the chunks under per-type
 * headings and has no data access.
 */
export default function RepoContextView({ types, chunks }: RepoContextViewProps) {
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
          {chunks.filter((c) => c.content_type === type).map((c) => (
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
