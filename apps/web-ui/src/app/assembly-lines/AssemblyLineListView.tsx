import Link from 'next/link';
import PRStatusBadge from './PRStatusBadge';
import styles from './AssemblyLineListView.module.css';
import {
  type AssemblyLine,
  type AssemblyLineStatus,
  type AssemblyLineTaskRow,
  deriveAssemblyLineStatus,
  statusVisual,
  formatDuration,
  formatRelativeTime,
} from '@/lib/assembly-lines';

export interface AssemblyLineListViewProps {
  /** The active status filter, or undefined for "All". */
  activeStatus?: string;
  runs: AssemblyLine[];
}

const FILTERS: AssemblyLineStatus[] = ['running', 'pr-created', 'review', 'merged', 'failed', 'needs-human', 'pending'];

/**
 * GitLab-pipelines-style list of assembly lines. Each row is one run (a chain of
 * related tasks producing one PR); the Stages cell is a mini-graph of the chain's
 * member tasks, each a server-rendered <details> dropdown. Pure render — the
 * container (`page.tsx`) groups the rows and passes the runs down.
 */
export default function AssemblyLineListView({ activeStatus, runs }: AssemblyLineListViewProps) {
  return (
    <div>
      <div className={styles.header}>
        <h1>Assembly Lines</h1>
        <Link href="/assembly-lines/create"><button>+ Create Task</button></Link>
      </div>

      <div className="filter-form">
        <a href="/assembly-lines" className={!activeStatus ? 'active' : ''}>All</a>
        {FILTERS.map(s => (
          <a key={s} href={`/assembly-lines?status=${s}`} className={activeStatus === s ? 'active' : ''}>{statusVisual(s).label}</a>
        ))}
      </div>

      <table className={styles.table}>
        <thead>
          <tr><th>Status</th><th>Assembly Line</th><th>Created by</th><th>Stages</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {runs.map(run => <AssemblyLineRow key={run.runKey} run={run} />)}
          {runs.length === 0 && <tr><td colSpan={5} className={`meta ${styles.emptyCell}`}>No assembly lines</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function AssemblyLineRow({ run }: { run: AssemblyLine }) {
  const visual = statusVisual(run.status);
  return (
    <tr>
      <td>
        <span className={styles.ciIcon}>
          <span className={`${styles.dot} ${styles[visual.tone]}`} />{visual.label}
        </span>
        <div className={styles.statusMeta}>
          <span>{formatDuration(run.startedAt, run.updatedAt)}</span>
          <span>{formatRelativeTime(run.updatedAt)}</span>
        </div>
      </td>

      <td>
        <Link href={`/assembly-lines/${run.lead.id}`} className={styles.runId}>#{run.lead.id.substring(0, 8)}</Link>
        <Link href={`/assembly-lines/${run.lead.id}`} className={styles.runTitle}>{run.lead.description}</Link>
        <div className={styles.metaRow}>
          {run.targetRepo && <Link href={`/repos/${run.targetRepo}`} className={styles.metaBadge}>{run.targetRepo}</Link>}
          {run.lead.target_branch && <span className={styles.metaBadge}>{run.lead.target_branch}</span>}
          {run.prUrl && (
            <span className={styles.prCell}>
              <a href={run.prUrl} target="_blank" className={styles.metaBadge}>{run.prNumber ? `#${run.prNumber}` : 'PR'}</a>
              {run.prNumber && <PRStatusBadge taskId={run.lead.id} />}
            </span>
          )}
        </div>
      </td>

      <td><span className={styles.avatar} title={run.lead.created_by}>{initials(run.lead.created_by)}</span></td>

      <td>
        <div className={styles.miniGraph} data-testid="al-mini-graph">
          {run.members.map(m => <StageDot key={m.id} member={m} />)}
        </div>
      </td>

      <td>
        <div className={styles.actions}>
          {run.lead.status === 'pending' && (
            <form action={`/api/assembly-lines/${run.lead.id}/run-now`} method="POST" className={styles.runNowForm}>
              <button type="submit" className={styles.runNowBtn}>Run Now</button>
            </form>
          )}
          {run.prUrl && <a href={run.prUrl} target="_blank" className={styles.actionLink}>Open PR</a>}
        </div>
      </td>
    </tr>
  );
}

function StageDot({ member }: { member: AssemblyLineTaskRow }) {
  const tone = statusVisual(deriveAssemblyLineStatus([member])).tone;
  return (
    <details className={styles.stage} data-testid="al-stage">
      <summary className={styles.stageSummary} title={`${member.task_type}: ${member.status}`}>
        <span className={`${styles.stageDot} ${styles[tone]}`} aria-label={`${member.task_type}: ${member.status}`} />
      </summary>
      <div className={styles.stagePanel}>
        <div className={styles.stagePanelHead}>{member.task_type}</div>
        <Link href={`/assembly-lines/${member.id}`} className={styles.stageLink}>
          <span className={`op-badge op-${member.status}`}>{member.status}</span>
          <span className={styles.stageDesc}>{member.description}</span>
        </Link>
      </div>
    </details>
  );
}

function initials(createdBy: string): string {
  return (createdBy.trim().slice(0, 2) || '—').toUpperCase();
}
