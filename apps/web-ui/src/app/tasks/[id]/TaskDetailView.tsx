import Link from "next/link";
import TaskRefreshProvider from "./TaskRefreshProvider";
import TaskSummaryCard from "./TaskSummaryCard";
import FailurePanel from "./FailurePanel";
import { TimeAgo } from "@/components/TimeAgo";
import { formatEnumLabel } from "@/lib/enum-label";
import type { TaskRuntimeEvent } from "@/lib/task-runtime";
import type { components } from "@/lib/api/schema";

/** The fifteen task fields this page renders — the field TYPES come from the contract. */
export type TaskDetailTask = Pick<
  components["schemas"]["TaskDetail"],
  | "id"
  | "description"
  | "task_type"
  | "status"
  | "priority"
  | "target_repo"
  | "target_branch"
  | "agent_id"
  | "pr_url"
  | "pr_number"
  | "review_iteration"
  | "failure_reason"
  | "created_by"
  | "created_at"
  | "updated_at"
>;

export type TaskDetailEvent = TaskRuntimeEvent;

/** One per-attempt run row (pipeline.assembly_runs) backing this task. */
export type TaskRunRow = components["schemas"]["TaskRunList"]["runs"][number];

/** Single attempt: run page is the detail; multiple: keep lifecycle shell with runs list. */
export function soleRunHref(runs: TaskRunRow[]): string | null {
  return runs.length === 1 ? `/assembly-runs/${runs[0].id}` : null;
}

export interface TaskDetailViewProps {
  task: TaskDetailTask;
  failedEvent: TaskDetailEvent | undefined;
  runs?: TaskRunRow[];
}

export default function TaskDetailView({
  task,
  failedEvent,
  runs = [],
}: TaskDetailViewProps) {
  return (
    <TaskRefreshProvider taskId={task.id} taskStatus={task.status} runs={runs}>
      <div>
        <h1>Task: {task.description.substring(0, 80)}</h1>
        <TaskSummaryCard task={task} />

        <TaskFailurePanel task={task} failedEvent={failedEvent} />

        <RunsSection runs={runs} />
      </div>
    </TaskRefreshProvider>
  );
}

function TaskFailurePanel({
  task,
  failedEvent,
}: {
  task: TaskDetailTask;
  failedEvent: TaskDetailEvent | undefined;
}) {
  if (task.status !== "failed" || !failedEvent?.metadata) {
    return null;
  }

  return (
    <FailurePanel metadata={failedEvent.metadata} repo={task.target_repo} />
  );
}

function RunsSection({ runs }: { runs: TaskRunRow[] }) {
  if (runs.length === 0) {
    return null;
  }

  return (
    <section>
      <h2>Runs</h2>
      <p className="meta">
        Each execution attempt of this task (a retry mints a new run). Open one
        for its timeline, transcript, and pod logs.
      </p>
      <ul>
        {runs.map((run) => (
          <RunListItem key={run.id} run={run} />
        ))}
      </ul>
    </section>
  );
}

function RunListItem({ run }: { run: TaskRunRow }) {
  return (
    <li>
      <Link href={`/assembly-runs/${run.id}`}>#{run.id.substring(0, 8)}</Link> —{" "}
      <span className={`op-badge op-${run.status}`}>
        {formatEnumLabel(run.outcome ?? run.status)}
      </span>{" "}
      · started <TimeAgo date={run.created_at} inline />
    </li>
  );
}
