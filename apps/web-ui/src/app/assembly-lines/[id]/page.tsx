export const dynamic = "force-dynamic";
import { query, queryOne } from '@/lib/db';
import { redirect } from 'next/navigation';
import TaskDetailView, {
  type TaskDetailTask,
  type TaskDetailEvent,
  type TaskDetailLlmCall,
} from './TaskDetailView';

type Task = TaskDetailTask;
type TaskEvent = TaskDetailEvent;
type LlmCall = TaskDetailLlmCall;

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

  redirect(`/assembly-lines/${taskId}`);
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
    `SELECT model, input_tokens, output_tokens, duration_ms, status, error, created_at
     FROM pipeline.llm_calls WHERE task_id = $1 ORDER BY created_at`,
    [id]
  );

  const failedEvent = events.find(e => e.to_status === 'failed');

  return (
    <TaskDetailView
      task={task}
      events={events}
      llmCalls={llmCalls}
      failedEvent={failedEvent}
      submitFeedback={submitFeedback}
    />
  );
}
