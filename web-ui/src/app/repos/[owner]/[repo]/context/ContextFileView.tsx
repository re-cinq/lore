import Link from 'next/link';
import ChunkBody from './ChunkBody';
import { type ChunkMeta } from '@/lib/chunk-presenter';
import styles from './ContextFileView.module.css';

export interface ContextFileChunk {
  id: string;
  content_type: string;
  content: string;
  metadata: ChunkMeta | null;
}

export interface ContextFileGroup {
  /** owner/name (or 'unknown') — used for GitHub links + the repo label. */
  repo: string;
  /** "view in repo →" target in the global view; null/absent per-repo. */
  repoHref?: string | null;
  branch?: string;
  chunks: ContextFileChunk[];
}

export interface ContextFileViewProps {
  filePath: string;
  /** Breadcrumb root — the list route this file belongs to. */
  contextLink: string;
  /** One group per repo. Per-repo detail passes a single group. */
  groups: ContextFileGroup[];
}

function basename(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

/**
 * Per-file context detail: the full (untruncated) chunks of one file path,
 * each rendered richly via `ChunkBody`. Shared by the per-repo detail route
 * (one group) and the global detail route (one group per repo, with a
 * "view in repo →" link). Pure render.
 */
export default function ContextFileView({ filePath, contextLink, groups }: ContextFileViewProps) {
  const total = groups.reduce((n, g) => n + g.chunks.length, 0);

  if (total === 0) {
    return (
      <div>
        <div className="breadcrumb">
          <Link href={contextLink}>Context</Link> / {filePath}
        </div>
        <h1>Not Found</h1>
        <div className="empty-state">
          <p>No context found at &quot;{filePath}&quot;.</p>
        </div>
      </div>
    );
  }

  const showGroupHeader = groups.length > 1 || groups.some((g) => g.repoHref);

  return (
    <div>
      <div className="breadcrumb">
        <Link href={contextLink}>Context</Link> / <strong>{basename(filePath)}</strong>
      </div>
      <h1>{basename(filePath)}</h1>
      <p className={`meta ${styles.path}`}>
        {filePath}
      </p>

      {groups.map((g, gi) => (
        <div key={g.repo} className={styles.group}>
          {showGroupHeader && (
            <div className={styles.groupHeader}>
              <span className="meta">repo: {g.repo}</span>
              {g.repoHref && (
                <Link href={g.repoHref} className="meta">
                  view in repo →
                </Link>
              )}
            </div>
          )}
          {g.chunks.map((c, i) => (
            <div key={c.id}>
              <ChunkBody
                content={c.content}
                contentType={c.content_type}
                filePath={filePath}
                repo={g.repo}
                branch={g.branch ?? 'main'}
                metadata={c.metadata ?? undefined}
              />
              {i < g.chunks.length - 1 && <hr className={`${styles.hr} ${styles.chunkRule}`} />}
            </div>
          ))}
          {gi < groups.length - 1 && <hr className={`${styles.hr} ${styles.groupRule}`} />}
        </div>
      ))}
    </div>
  );
}
