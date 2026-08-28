export const dynamic = "force-dynamic";
import { getTask, getTaskRuns, reviseTask } from "@/lib/api/tasks";
import { redirect } from "next/navigation";
import TaskDetailView, {
  soleRunHref,
  type TaskDetailTask,
  type TaskRunRow,
} from "./TaskDetailView";
import { fetchTaskEvents } from "@/lib/task-runtime";

type Task = TaskDetailTask;

async function submitFeedback(formData: FormData) {
  "use server";
  const taskId = formData.get("task_id") as string;
  const feedback = formData.get("feedback") as string;

  if (!taskId || !feedback?.trim()) {
    return;
  }

  // One call: lore-api queues the revision on the same branch, records the
  // request on this task, and parks it at revision-requested.
  await reviseTask(taskId, feedback);

  redirect(`/tasks/${taskId}`);
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const taskResult = await getTask(id);
  const task = (
    taskResult.status === "ok" ? taskResult.data : null
  ) as Task | null;

  if (!task) {
    return (
      <div>
        <h1>Task not found</h1>
      </div>
    );
  }

  // The task's per-attempt run rows (pipeline.assembly_runs.task_id is non-unique
  // — a retry mints a fresh row) so the detail can link to each attempt's timeline.
  // queryAllowMissing: empty on pre-0025 DBs.
  const runResult = await getTaskRuns(id);
  const runs = (runResult.status === "ok"
    ? runResult.data.runs
    : []) as unknown as TaskRunRow[];

  const runHref = soleRunHref(runs);

  if (runHref) {
    redirect(runHref);
  }

  const events = await fetchTaskEvents(id);
  const failedEvent = events.find((e) => e.to_status === "failed");

  return (
    <TaskDetailView
      task={task}
      failedEvent={failedEvent}
      runs={runs}
      submitFeedback={submitFeedback}
    />
  );
}
