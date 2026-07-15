export const dynamic = "force-dynamic";
import { query, queryOne, queryAllowMissing } from "@/lib/db";
import { redirect } from "next/navigation";
import TaskDetailView, {
  type TaskDetailTask,
  type TaskRunRow,
} from "./TaskDetailView";
import { fetchTaskEvents, fetchLlmCalls } from "@/lib/task-runtime";

type Task = TaskDetailTask;

async function submitFeedback(formData: FormData) {
  "use server";
  const taskId = formData.get("task_id") as string;
  const feedback = formData.get("feedback") as string;

  if (!taskId || !feedback?.trim()) {
    return;
  }

  const task = await queryOne<Task>(
    `SELECT * FROM pipeline.tasks WHERE id = $1`,
    [taskId],
  );

  if (!task) {
    return;
  }

  // Create a revision task on the same branch with the feedback (immediate — active feedback loop)
  const result = await query<{ id: string }>(
    `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, context_bundle, priority)
     VALUES ($1, $2, $3, $4, $5, 'immediate') RETURNING id`,
    [
      `Revise based on feedback: ${feedback.substring(0, 200)}`,
      task.task_type === "feature-request"
        ? "feature-request"
        : "implementation",
      task.target_repo,
      "ui-feedback",
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
    [
      taskId,
      task.status,
      "revision-requested",
      JSON.stringify({ feedback, revision_task_id: result[0].id }),
    ],
  );
  await query(
    `UPDATE pipeline.tasks SET status = 'revision-requested', updated_at = now() WHERE id = $1`,
    [taskId],
  );

  redirect(`/tasks/${taskId}`);
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const task = await queryOne<Task>(
    `SELECT * FROM pipeline.tasks WHERE id = $1`,
    [id],
  );

  if (!task) {
    return (
      <div>
        <h1>Task not found</h1>
      </div>
    );
  }

  const events = await fetchTaskEvents(id);
  const llmCalls = await fetchLlmCalls(id);

  const failedEvent = events.find((e) => e.to_status === "failed");

  // The task's per-attempt run rows (pipeline.assembly_lines.task_id is non-unique
  // — a retry mints a fresh row) so the detail can link to each attempt's timeline.
  // queryAllowMissing: empty on pre-0025 DBs.
  const runs = await queryAllowMissing<TaskRunRow>(
    `SELECT id, status, outcome, created_at
       FROM pipeline.assembly_lines
      WHERE task_id = $1
      ORDER BY created_at DESC`,
    [id],
  );

  return (
    <TaskDetailView
      task={task}
      events={events}
      llmCalls={llmCalls}
      failedEvent={failedEvent}
      runs={runs}
      submitFeedback={submitFeedback}
    />
  );
}
