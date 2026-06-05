import Link from 'next/link';
import HelpPopover from '@/components/HelpPopover';
import { formatCost, shortAgentId, truncate, displayCreatedBy } from '@/lib/task-presenter';
import styles from './RepoTasksView.module.css';

export interface RepoTaskRow {
  id: string;
  description: string | null;
  task_type: string;
  status: string;
  agent_id: string | null;
  pr_url: string | null;
  created_at: string;
  created_by: string | null;
  cost_usd: number;
}

export interface RepoTasksViewProps {
  owner: string;
  repo: string;
  tasks: RepoTaskRow[];
}

/**
 * Presentational view for a repo's pipeline task list. Pure render — the
 * container (`page.tsx`) fetches the rows and this component only renders
 * them. Read-only: no server actions, no callbacks (pure data down).
 */
export default function RepoTasksView({ owner, repo, tasks }: RepoTasksViewProps) {
  return (
    <div>
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title}>Tasks</h2>
          <HelpPopover label="How tasks work">
            <p>Tasks are units of work you delegate to Lore agents for this repo.</p>
            <ul>
              <li>Each runs the pipeline: pull repo context → agent works → deterministic validation (lint/typecheck) → branch + PR (and a GitHub issue).</li>
              <li>Simple types run via direct API calls; <strong>implementation</strong> and <strong>review</strong> run in ephemeral Job pods.</li>
              <li>Which types are allowed is gated by the repo&apos;s <strong>trust level</strong> (see Settings).</li>
            </ul>
          </HelpPopover>
        </div>
        <Link href={`/repos/${owner}/${repo}/tasks/create`}><button>+ New Task</button></Link>
      </div>
      <p className={`meta ${styles.intro}`}>
        Pipeline tasks targeting this repo. Delegate work to agents and track their status, PRs, and history.
      </p>
      <table>
        <thead><tr><th>Why (task)</th><th>Type</th><th>Status</th><th>Created by</th><th>Cost</th><th>Agent</th><th>PR</th><th>Created</th></tr></thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id}>
              <td><Link href={`/pipeline/${t.id}`}>{truncate(t.description, 50)}</Link></td>
              <td><span className="badge">{t.task_type}</span></td>
              <td><span className={`op-badge op-${t.status}`}>{t.status}</span></td>
              <td className="meta">{displayCreatedBy(t.created_by)}</td>
              <td>{formatCost(t.cost_usd)}</td>
              <td className="meta">{shortAgentId(t.agent_id)}</td>
              <td>{t.pr_url ? <a href={t.pr_url} target="_blank">PR</a> : '—'}</td>
              <td className="meta">{new Date(t.created_at).toLocaleString()}</td>
            </tr>
          ))}
          {tasks.length === 0 && <tr><td colSpan={8} className={`meta ${styles.emptyCell}`}>No tasks for this repo</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
