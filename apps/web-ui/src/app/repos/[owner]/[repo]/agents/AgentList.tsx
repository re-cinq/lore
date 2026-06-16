import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { AgentDefinition } from '@/lib/agents-mirror';
import styles from './agents.module.css';

/**
 * Read-only list of a repo's resolved agents. An agent with no project row is
 * labelled `org` (the organisation default); once overridden it's `project`.
 * Editing/creating happens on dedicated pages (Edit / New agent links) so the
 * Agents tab stays selected with a breadcrumb.
 */
export default function AgentList({ base, agents }: { base: string; agents: AgentDefinition[] }) {
  return (
    <div>
      <p className={styles.hint}>
        Per-repo agents. An <strong>org</strong> agent is the organisation default; editing one
        creates a <strong>project</strong> agent for this repo, and later edits update that project agent.
      </p>

      <div className={styles.actions}>
        <Link className="btn-secondary" href={`${base}/agents/new`}>+ New agent</Link>
      </div>

      {agents.length === 0 ? (
        <div className="empty-state"><p>No agents resolved for this repo.</p></div>
      ) : (
        <div className={styles.list}>
          {agents.map((a) => {
            const isProject = a.project_id != null && a.project_id !== '';
            return (
              <div key={a.name} className={styles.card}>
                <span className={styles.name}>{a.name}</span>
                <span
                  className="status-pill"
                  style={{ '--pill-color': isProject ? 'var(--accent)' : 'var(--text-muted)' } as CSSProperties}
                >
                  {isProject ? 'project' : 'org'}
                </span>
                <span className={styles.detail}>
                  {a.model ?? '(inherit)'} · {a.timeout_minutes ?? '–'}m
                  {a.execution_mode === 'graph-ingest' ? ' · zero-LLM' : ''}
                </span>
                <Link className={`btn-secondary ${styles.spacer}`} href={`${base}/agents/${encodeURIComponent(a.name)}/edit`}>
                  Edit
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
