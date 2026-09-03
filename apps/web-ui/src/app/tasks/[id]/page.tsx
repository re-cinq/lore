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

  // lore-api queues revision on same branch.
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

  // Per-attempt run rows for retry linking (pipeline.assembly_runs.task_id is non-unique).
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
