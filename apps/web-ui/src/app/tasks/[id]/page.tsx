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
  const taskId = formData.get("task_id") as string | null;
  const feedback = formData.get("feedback") as string | null;

  if (!taskId || !feedback?.trim()) {
    return;
  }

  // lore-api queues revision on same branch.
  await reviseTask(taskId, feedback);

  redirect(`/tasks/${taskId}`);
}

/** The task, or null when there isn't one. An unreachable lore-api reads the same as a missing task here on purpose: either way this page has nothing to show, and the reader's next move is the same. */
async function readTask(id: string): Promise<Task | null> {
  const result = await getTask(id);

  return (result.status === "ok" ? result.data : null) as Task | null;
}

/** Per-attempt run rows, for retry linking. `pipeline.assembly_runs.task_id` is non-unique — one task can have several attempts, and the newest is not always the one the reader wants. */
async function readTaskRuns(id: string): Promise<TaskRunRow[]> {
  const result = await getTaskRuns(id);

  return (result.status === "ok"
    ? result.data.runs
    : []) as unknown as TaskRunRow[];
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const task = await readTask(id);

  if (!task) {
    return (
      <div>
        <h1>Task not found</h1>
      </div>
    );
  }
  const runs = await readTaskRuns(id);
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
