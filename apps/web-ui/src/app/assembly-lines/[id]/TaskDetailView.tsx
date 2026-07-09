import PRStatusCard from './PRStatusCard';
import { CancelTaskButton } from './CancelTaskButton';
import TaskLogs from './TaskLogs';
import Timeline from './Timeline';
import FailurePanel from './FailurePanel';
import Linkified from '@/components/Linkified';
import { isCancellable } from '@/lib/task-status';
import { TimeAgo } from '@/components/TimeAgo';
import { humanizeEnum } from '@/lib/humanize';
import styles from './TaskDetailView.module.css';

export interface TaskDetailTask {
  id: string;
  description: string;
  task_type: string;
  status: string;
  priority: string;
  target_repo: string;
  target_branch: string | null;
  agent_id: string | null;
  pr_url: string | null;
  pr_number: number | null;
  review_iteration: number;
  failure_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TaskDetailEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface TaskDetailLlmCall {
  model: string;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  status: string | null;
  error: string | null;
  created_at: string;
}

export interface TaskDetailViewProps {
  task: TaskDetailTask;
  events: TaskDetailEvent[];
  llmCalls: TaskDetailLlmCall[];
  failedEvent: TaskDetailEvent | undefined;
  submitFeedback: (formData: FormData) => void | Promise<void>;
}

export default function TaskDetailView({
  task,
  events,
  llmCalls,
  failedEvent,
  submitFeedback,
}: TaskDetailViewProps) {
  return (
    <div>
      <h1>Task: {task.description.substring(0, 80)}</h1>
      <div className="spec-card">
        <p><strong>Type:</strong> <span className="badge">{task.task_type}</span></p>
        <p><strong>Status:</strong> <span className={`op-badge op-${task.status}`}>{task.status}</span></p>
        <p>
          <strong>Priority:</strong>{' '}
          <span className={task.priority === 'immediate' ? 'badge badge-red' : 'meta'}>
            {task.priority || 'normal'}
          </span>
        </p>
        <p><strong>Repo:</strong> {task.target_repo}</p>
        <p><strong>Description:</strong> <Linkified text={task.description} repo={task.target_repo} /></p>
        {task.agent_id && <p><strong>Agent:</strong> {task.agent_id}</p>}
        {task.pr_url && <p><strong>PR:</strong> <a href={task.pr_url} target="_blank">{task.pr_url}</a></p>}
        {task.pr_url && task.pr_number && (
          <PRStatusCard taskId={task.id} prUrl={task.pr_url} />
        )}
        {task.failure_reason && <p><strong>Failure:</strong> <span className={styles.failureText}><Linkified text={task.failure_reason} repo={task.target_repo} /></span></p>}
        {task.review_iteration > 0 && <p><strong>Review iterations:</strong> {task.review_iteration}</p>}
        <p><strong>Created by:</strong> {task.created_by}</p>
        <p className="meta">Created: <TimeAgo date={task.created_at} /> · Updated: <TimeAgo date={task.updated_at} /></p>
        <div className={styles.actions}>
          {task.status === 'pending' && (task.priority || 'normal') === 'normal' && (
            <form action={`/api/assembly-lines/${task.id}/run-now`} method="POST">
              <button type="submit" className={styles.runNowBtn}>
                Run Now
              </button>
            </form>
          )}
          {isCancellable(task.status) && <CancelTaskButton taskId={task.id} />}
        </div>
      </div>

      {task.status === 'failed' && failedEvent?.metadata && (
        <FailurePanel metadata={failedEvent.metadata} repo={task.target_repo} />
      )}

      {/* Feedback form — visible when task has a PR and isn't in a terminal state */}
      {task.pr_url && !['merged', 'cancelled'].includes(task.status) && (
        <div className={`spec-card ${styles.feedbackCard}`}>
          <h3 className={styles.feedbackHeading}>Give Feedback</h3>
          <p className={`meta ${styles.feedbackLede}`}>
            Tell the agent what to change. A revision task will be created on the same branch.
          </p>
          <form action={submitFeedback}>
            <input type="hidden" name="task_id" value={task.id} />
            <textarea
              name="feedback"
              rows={3}
              required
              placeholder="e.g. Don't use a custom CLI — use the existing MCP tools instead. The approach should be..."
              className={styles.feedbackTextarea}
            />
            <button type="submit" className={styles.feedbackBtn}>
              Request Revision
            </button>
          </form>
        </div>
      )}

      <Timeline taskId={task.id} initialStatus={task.status} />

      <TaskLogs taskId={task.id} initialStatus={task.status} />

      <h2>Event Timeline</h2>
      <div className="memory-list">
        {events.map(e => (
          <div key={e.id} className={`version ${styles.event}`}>
            <span className={`op-badge op-${e.to_status}`}>{humanizeEnum(e.to_status)}</span>
            {e.from_status && <span className="meta"> ← {humanizeEnum(e.from_status)}</span>}
            <span className={`meta ${styles.eventTime}`}><TimeAgo date={e.created_at} /></span>
            {e.metadata && <pre className={styles.eventMeta}>{JSON.stringify(e.metadata, null, 2)}</pre>}
          </div>
        ))}
      </div>

      <h2>LLM Calls</h2>
      {llmCalls.length > 0 ? (
        <table>
          <thead>
            <tr><th>Model</th><th>Status</th><th>Tokens (in/out)</th><th>Duration</th><th>Time</th></tr>
          </thead>
          <tbody>
            {llmCalls.map((c, i) => (
              <tr key={i}>
                <td className={styles.mono}>{c.model}</td>
                <td>
                  {c.status === 'failed'
                    ? <span className="badge badge-red" title={c.error ?? undefined}>failed</span>
                    : <span className="op-badge op-pr-created">success</span>}
                  {c.status === 'failed' && c.error && (
                    <div className={`meta ${styles.callError}`}>
                      <Linkified text={c.error} repo={task.target_repo} />
                    </div>
                  )}
                </td>
                <td className={styles.mono}>{Number(c.input_tokens).toLocaleString()} / {Number(c.output_tokens).toLocaleString()}</td>
                <td className={styles.mono}>{c.duration_ms ? `${(Number(c.duration_ms) / 1000).toFixed(1)}s` : '—'}</td>
                <td className="meta"><TimeAgo date={c.created_at} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="meta">No LLM calls recorded for this task.</p>
      )}
    </div>
  );
}
