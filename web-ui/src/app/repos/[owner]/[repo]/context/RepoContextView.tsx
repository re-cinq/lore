import HelpPopover from '@/components/HelpPopover';
import ContextFilters from './ContextFilters';
import ContextCard from './ContextCard';
import LoadMore from './LoadMore';
import { CONTEXT_PAGE_SIZE } from './pagination';
import { type ChunkMeta } from '@/lib/chunk-presenter';
import styles from './RepoContextView.module.css';

export interface RepoContextChunk {
  id: string;
  file_path: string;
  content_type: string;
  content: string;
  ingested_at: string;
  metadata: ChunkMeta | null;
}

export interface RepoContextViewProps {
  owner: string;
  repo: string;
  /** Active content_type filter, or undefined for "All". */
  type?: string;
  /** Active keyword query, or undefined. */
  q?: string;
  /** Distinct content_types present in this repo (drives the filter chips). */
  types: string[];
  chunks: RepoContextChunk[];
  /** Whether more chunks exist beyond the first server-rendered page. */
  hasMore?: boolean;
}

function emptyMessage(q?: string, type?: string): string {
  if (q) return `No context matches “${q}”${type ? ` in ${type}` : ''}.`;
  if (type) return `No ${type} context ingested yet.`;
  return 'No context ingested yet. Context will appear after the nightly ingestion runs.';
}

/**
 * Presentational view for a single repo's ingested context. Pure render — the
 * container (`page.tsx`) runs the schema-scoped queries (distinct types,
 * filtered + ranked chunks) and hands the view-model down. Each chunk renders
 * as a rich card linking to its per-file detail page.
 */
export default function RepoContextView({
  owner,
  repo,
  type,
  q,
  types,
  chunks,
  hasMore = false,
}: RepoContextViewProps) {
  const base = `/repos/${owner}/${repo}/context`;
  const fullName = `${owner}/${repo}`;
  return (
    <div>
      <div className={styles.header}>
        <h2 className={styles.title}>Context</h2>
        <HelpPopover label="How context is used">
          <p>Context is everything Lore has ingested about this repo — conventions, ADRs, specs, and code — stored as embedded chunks.</p>
          <ul>
            <li>Agents load it on turn 1 of every task via <code>assemble_context</code>, and search it with <code>search_context</code>.</li>
            <li>It is refreshed by nightly ingestion; a repo not ingested in over 7 days is flagged <strong>stale</strong>.</li>
            <li>Higher-signal chunks (incidents, conflicts, recent facts) are surfaced first within the token budget.</li>
          </ul>
        </HelpPopover>
      </div>
      <p className={`meta ${styles.intro}`}>
        Conventions, ADRs, specs, and code ingested from this repo that agents use as context.
      </p>

      <ContextFilters basePath={base} types={types} activeType={type} q={q} />

      <p className="meta">
        {hasMore ? `showing first ${chunks.length}` : `${chunks.length}`} chunk
        {chunks.length === 1 ? '' : 's'}
        {q ? ` matching “${q}”` : ''}
      </p>

      {chunks.length === 0 ? (
        <p className="meta">{emptyMessage(q, type)}</p>
      ) : (
        <>
          {chunks.map((c) => (
            <ContextCard
              key={c.id}
              chunk={c}
              repo={fullName}
              detailHref={`${base}/${encodeURIComponent(c.file_path)}`}
            />
          ))}
          <LoadMore
            owner={owner}
            repo={repo}
            q={q}
            type={type}
            initialOffset={CONTEXT_PAGE_SIZE}
            hasMore={hasMore}
          />
        </>
      )}
    </div>
  );
}
