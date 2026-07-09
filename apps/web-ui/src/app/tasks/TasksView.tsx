import { TimeAgo } from '@/components/TimeAgo';
import { humanizeEnum } from '@/lib/humanize';
import { SubmitButton } from '@/components/SubmitButton';
import styles from './TasksView.module.css';

interface Task {
  id: string;
  content: string;
  content_type: string;
  metadata: Record<string, string>;
  ingested_at: string;
}

interface AuditEntry {
  agent_id: string;
  operation: string;
  memory_key: string;
  metadata: Record<string, string>;
  created_at: string;
}

export interface TasksViewProps {
  tasks: Task[];
  recentActivity: AuditEntry[];
  createTask: (formData: FormData) => void | Promise<void>;
}

export default function TasksView({ tasks, recentActivity, createTask }: TasksViewProps) {
  return (
    <div>
      <h1>Tasks</h1>
      <div className={styles.banner}>
        <p className={`meta ${styles.bannerText}`}>
          This is the global view across all repos. For repo-specific tasks, visit{' '}
          <a href="/">Repositories</a> and select a repo.
        </p>
      </div>

      <section className={styles.section}>
        <h2>Create Task</h2>
        <form action={createTask}>
          <textarea
            name="description"
            placeholder="Describe the task for agents..."
            required
            rows={3}
            className={styles.textarea}
          />
          <SubmitButton pendingLabel="Creating…">Create Task</SubmitButton>
        </form>
      </section>

      <section className={styles.section}>
        <h2>Existing Tasks</h2>
        {tasks.length === 0 ? (
          <p className="meta">No tasks found. Create one above.</p>
        ) : (
          tasks.map((task) => {
            const status = task.metadata?.status || 'unknown';
            return (
              <div key={task.id} className="spec-card">
                <div className={styles.cardHead}>
                  <span className={`badge ${status === 'open' ? 'badge-open' : ''}`}>{humanizeEnum(status)}</span>
                  <span className="meta"><TimeAgo date={task.ingested_at} /></span>
                </div>
                <p>{task.content}</p>
              </div>
            );
          })
        )}
      </section>

      <section>
        <h2>Recent Agent Activity</h2>
        {recentActivity.length === 0 ? (
          <p className="meta">No recent agent activity recorded.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Agent</th>
                <th className={styles.th}>Operation</th>
                <th className={styles.th}>Key</th>
                <th className={styles.th}>Time</th>
              </tr>
            </thead>
            <tbody>
              {recentActivity.map((entry, i) => (
                <tr key={i}>
                  <td className={styles.td}>{entry.agent_id}</td>
                  <td className={styles.td}>
                    <span className="badge">{humanizeEnum(entry.operation)}</span>
                  </td>
                  <td className={styles.td}>{entry.memory_key}</td>
                  <td className={`meta ${styles.td}`}>
                    <TimeAgo date={entry.created_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
