export const dynamic = "force-dynamic";
import { query, queryOne } from '@/lib/db';
import { redirect } from 'next/navigation';
import PRStatusCard from './PRStatusCard';
import TaskLogs from './TaskLogs';

interface Task {
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

interface TaskEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  metadata: any;
  created_at: string;
}

interface LlmCall {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_ms: number;
  created_at: string;
}

async function submitFeedback(formData: FormData) {
  'use server';
  const taskId = formData.get('task_id') as string;
  const feedback = formData.get('feedback') as string;
  if (!taskId || !feedback?.trim()) return;

  const task = await queryOne<Task>(`SELECT * FROM pipeline.tasks WHERE id = $1`, [taskId]);
  if (!task) return;

  // Create a revision task on the same branch with the feedback (immediate — active feedback loop)
  const result = await query<{ id: string }>(
    `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle, priority)
     VALUES ($1, $2, $3, $4, $5, 'immediate') RETURNING id`,
    [
      `Revise based on feedback: ${feedback.substring(0, 200)}`,
      task.task_type === 'feature-request' ? 'feature-request' : 'implementation',
      task.target_repo,
      'ui-feedback',
      JSON.stringify({
        parent_task_id: taskId,
        branch: task.target_branch,
        pr_number: task.pr_number,
        feedback,
      }),
    ],
  );

  // Log the feedback event on the original task
  await query(
    `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata) VALUES ($1, $2, $3, $4)`,
    [taskId, task.status, 'revision-requested', JSON.stringify({ feedback, revision_task_id: result[0].id })],
  );
  await query(
    `UPDATE pipeline.tasks SET status = 'revision-requested', updated_at = now() WHERE id = $1`,
    [taskId],
  );

  redirect(`/pipeline/${taskId}`);
}

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await queryOne<Task>(`SELECT * FROM pipeline.tasks WHERE id = $1`, [id]);
  if (!task) return <div><h1>Task not found</h1></div>;

  const events = await query<TaskEvent>(
    `SELECT * FROM pipeline.task_events WHERE task_id = $1 ORDER BY created_at`,
    [id]
  );

  const llmCalls = await query<LlmCall>(
    `SELECT model, input_tokens, output_tokens, cost_usd, duration_ms, created_at
     FROM pipeline.llm_calls WHERE task_id = $1 ORDER BY created_at`,
    [id]
  );

  const totalLlmCost = llmCalls.reduce((sum, c) => sum + Number(c.cost_usd), 0);

  return (
    <div>
      <h1>Task: {task.description.substring(0, 80)}</h1>
      <div className="spec-card">
        <p><strong>Type:</strong> <span className="badge">{task.task_type}</span></p>
        <p><strong>Status:</strong> <span className={`op-badge op-${task.status}`}>{task.status}</span></p>
        <p>
          <strong>Priority:</strong>{' '}
          <span className={task.priority === 'immediate' ? 'badge' : 'meta'} style={task.priority === 'immediate' ? {background:'#7c3aed',color:'white',padding:'2px 8px',borderRadius:'4px'} : {}}>
            {task.priority || 'normal'}
          </span>
        </p>
        <p><strong>Repo:</strong> {task.target_repo}</p>
        {task.agent_id && <p><strong>Agent:</strong> {task.agent_id}</p>}
        {task.pr_url && <p><strong>PR:</strong> <a href={task.pr_url} target="_blank">{task.pr_url}</a></p>}
        {task.pr_url && task.pr_number && (
          <PRStatusCard taskId={task.id} prUrl={task.pr_url} />
        )}
        {task.failure_reason && <p><strong>Failure:</strong> <span style={{color:'#f87171'}}>{task.failure_reason}</span></p>}
        {task.review_iteration > 0 && <p><strong>Review iterations:</strong> {task.review_iteration}</p>}
        <p><strong>Created by:</strong> {task.created_by}</p>
        <p className="meta">Created: {new Date(task.created_at).toLocaleString()} · Updated: {new Date(task.updated_at).toLocaleString()}</p>
        <div style={{display:'flex', gap:'8px', marginTop:'12px'}}>
          {task.status === 'pending' && (task.priority || 'normal') === 'normal' && (
            <form action={`/api/pipeline/${task.id}/run-now`} method="POST">
              <button type="submit" style={{background:'#7c3aed',color:'white',border:'none',padding:'6px 16px',borderRadius:'4px',cursor:'pointer'}}>
                Run Now
              </button>
            </form>
          )}
          {!['merged', 'failed', 'cancelled'].includes(task.status) && (
            <form action={`/api/pipeline/${task.id}/cancel`} method="POST">
              <button type="submit" style={{background:'#dc2626',color:'white',border:'none',padding:'6px 16px',borderRadius:'4px',cursor:'pointer'}}>
                Cancel Task
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Feedback form — visible when task has a PR and isn't in a terminal state */}
      {task.pr_url && !['merged', 'cancelled'].includes(task.status) && (
        <div className="spec-card" style={{ marginTop: '16px' }}>
          <h3 style={{ margin: '0 0 8px 0' }}>Give Feedback</h3>
          <p className="meta" style={{ marginBottom: '8px' }}>
            Tell the agent what to change. A revision task will be created on the same branch.
          </p>
          <form action={submitFeedback}>
            <input type="hidden" name="task_id" value={task.id} />
            <textarea
              name="feedback"
              rows={3}
              required
              placeholder="e.g. Don't use a custom CLI — use the existing MCP tools instead. The approach should be..."
              style={{ width: '100%', marginBottom: '8px' }}
            />
            <button type="submit" style={{ background: '#2563eb', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '4px', cursor: 'pointer' }}>
              Request Revision
            </button>
          </form>
        </div>
      )}

      <TaskLogs taskId={task.id} initialStatus={task.status} />

      <h2>Event Timeline</h2>
      <div className="memory-list">
        {events.map(e => (
          <div key={e.id} className="version" style={{marginBottom:'12px'}}>
            <span className={`op-badge op-${e.to_status}`}>{e.to_status}</span>
            {e.from_status && <span className="meta"> ← {e.from_status}</span>}
            <span className="meta" style={{marginLeft:'12px'}}>{new Date(e.created_at).toLocaleString()}</span>
            {e.metadata?.cost_usd && <span className="badge" style={{marginLeft:'8px'}}>{'$' + Number(e.metadata.cost_usd).toFixed(4)}</span>}
            {e.metadata && <pre style={{marginTop:'4px',fontSize:'12px'}}>{JSON.stringify(e.metadata, null, 2)}</pre>}
          </div>
        ))}
      </div>

      <h2>LLM Calls {llmCalls.length > 0 && <span className="badge" style={{marginLeft:'8px', fontSize:'14px'}}>${totalLlmCost.toFixed(2)} total</span>}</h2>
      {llmCalls.length > 0 ? (
        <table>
          <thead>
            <tr><th>Model</th><th>Tokens (in/out)</th><th>Cost</th><th>Duration</th><th>Time</th></tr>
          </thead>
          <tbody>
            {llmCalls.map((c, i) => (
              <tr key={i}>
                <td style={{fontFamily:'monospace', fontSize:'12px'}}>{c.model}</td>
                <td style={{fontFamily:'monospace', fontSize:'12px'}}>{Number(c.input_tokens).toLocaleString()} / {Number(c.output_tokens).toLocaleString()}</td>
                <td style={{fontFamily:'monospace', fontSize:'12px'}}>${Number(c.cost_usd).toFixed(4)}</td>
                <td style={{fontFamily:'monospace', fontSize:'12px'}}>{c.duration_ms ? `${(Number(c.duration_ms) / 1000).toFixed(1)}s` : '—'}</td>
                <td className="meta">{new Date(c.created_at).toLocaleString()}</td>
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
