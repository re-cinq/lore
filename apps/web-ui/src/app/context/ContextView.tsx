import ContextFilters from '@/app/repos/[owner]/[repo]/context/ContextFilters';
import ContextCard from '@/app/repos/[owner]/[repo]/context/ContextCard';
import { type ChunkMeta } from '@/lib/chunk-presenter';
import { EmptyState } from '@/components/EmptyState';
import styles from './ContextView.module.css';

export interface ContextChunk {
  id: string;
  file_path: string;
  content_type: string;
  content: string;
  ingested_at: string;
  repo: string | null;
  metadata: ChunkMeta | null;
}

export interface ContextViewProps {
  /** Active content_type filter, or undefined for "All". */
  type?: string;
  /** Active keyword query, or undefined. */
  q?: string;
  /** Distinct content_types present across all repos (drives the chips). */
  types: string[];
  chunks: ContextChunk[];
}

/**
 * Presentational view for the global cross-repo context list. Pure render —
 * the container (`page.tsx`) runs the cross-schema queries (distinct types,
 * filtered + ranked chunks, capped at 50) and passes the resolved view-model
 * down. Each card carries its repo label and links to the global detail page.
 */
export default function ContextView({ type, q, types, chunks }: ContextViewProps) {
  const emptyState = q || type ? (
    <EmptyState
      title="No matches for this filter"
      description="No ingested context matches the current search or type filter."
      action={{ href: '/context', label: 'Clear filters' }}
    />
  ) : (
    <EmptyState
      title="Nothing ingested yet"
      description={<>Context is ingested nightly after a repo is onboarded, or on demand via <code>lore_ingest_files</code>.</>}
    />
  );

  return (
    <div>
      <h1>Context</h1>
      <div className={styles.notice}>
        <p className={`meta ${styles.noticeText}`}>
          This is the global view across all repos. For repo-specific context, visit{' '}
          <a href="/">Repositories</a> and select a repo.
        </p>
      </div>

      <ContextFilters basePath="/context" types={types} activeType={type} q={q} />

      {chunks.length === 0 ? (
        emptyState
      ) : (
        chunks.map((c) => (
          <ContextCard
            key={c.id}
            chunk={c}
            repo={c.repo ?? ''}
            repoLabel={c.repo ?? undefined}
            detailHref={`/context/${encodeURIComponent(c.file_path)}`}
          />
        ))
      )}
    </div>
  );
}
