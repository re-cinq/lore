import Link from "next/link";
import PRStatusPanel from "./PRStatusPanel";
import TaskRefreshProvider from "./TaskRefreshProvider";
import { CancelTaskButton } from "./CancelTaskButton";
import FailurePanel from "./FailurePanel";
import Linkified from "@/components/Linkified";
import { isCancellable } from "@/lib/task-status";
import { TimeAgo } from "@/components/TimeAgo";
import { formatEnumLabel } from "@/lib/enum-label";
import type { TaskRuntimeEvent } from "@/lib/task-runtime";
import styles from "./TaskDetailView.module.css";
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
  submitFeedback: (formData: FormData) => void | Promise<void>;
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={priority === "immediate" ? "badge badge-red" : "meta"}>
      {priority || "normal"}
    </span>
  );
}

function AgentRow({ agentId }: { agentId: string | null }) {
  if (!agentId) {
    return null;
  }

  return (
    <p>
      <strong>Agent:</strong> {agentId}
    </p>
  );
}

function PrLinkRow({ prUrl }: { prUrl: string | null }) {
  if (!prUrl) {
    return null;
  }

  return (
    <p>
      <strong>PR:</strong>{" "}
      <a href={prUrl} target="_blank">
        {prUrl}
      </a>
    </p>
  );
}

function PrStatusSection({
  taskId,
  prUrl,
  prNumber,
}: {
  taskId: string;
  prUrl: string | null;
  prNumber: number | null;
}) {
  if (!prUrl || !prNumber) {
    return null;
  }

  return <PRStatusPanel taskId={taskId} prUrl={prUrl} />;
}

function FailureRow({
  failureReason,
  repo,
}: {
  failureReason: string | null;
  repo: string;
}) {
  if (!failureReason) {
    return null;
  }

  return (
    <p>
      <strong>Failure:</strong>{" "}
      <span className={styles.failureText}>
        <Linkified text={failureReason} repo={repo} />
      </span>
    </p>
  );
}

function ReviewIterationsRow({ reviewIteration }: { reviewIteration: number }) {
  if (reviewIteration <= 0) {
    return null;
  }

  return (
    <p>
      <strong>Review iterations:</strong> {reviewIteration}
    </p>
  );
}

function RunNowAction({
  taskId,
  status,
  priority,
}: {
  taskId: string;
  status: string;
  priority: string;
}) {
  if (status !== "pending" || (priority || "normal") !== "normal") {
    return null;
  }

  return (
    <form action={`/api/tasks/${taskId}/run-now`} method="POST">
      <button type="submit" className={styles.runNowBtn}>
        Run Now
      </button>
    </form>
  );
}

function CancelAction({ taskId, status }: { taskId: string; status: string }) {
  if (!isCancellable(status)) {
    return null;
  }

  return <CancelTaskButton taskId={taskId} />;
}

function TaskFailurePanel({
  status,
  failedEvent,
  repo,
}: {
  status: string;
  failedEvent: TaskDetailEvent | undefined;
  repo: string;
}) {
  if (status !== "failed" || !failedEvent?.metadata) {
    return null;
  }

  return <FailurePanel metadata={failedEvent.metadata} repo={repo} />;
}

const TERMINAL_TASK_STATUSES = ["merged", "cancelled"];

/** Visible when the task has a PR and isn't in a terminal state. */
function FeedbackSection({
  taskId,
  prUrl,
  status,
  submitFeedback,
}: {
  taskId: string;
  prUrl: string | null;
  status: string;
  submitFeedback: (formData: FormData) => void | Promise<void>;
}) {
  if (!prUrl || TERMINAL_TASK_STATUSES.includes(status)) {
    return null;
  }

  return (
    <div className={`spec-card ${styles.feedbackCard}`}>
      <h3 className={styles.feedbackHeading}>Give Feedback</h3>
      <p className={`meta ${styles.feedbackLede}`}>
        Tell the agent what to change. A revision task will be created on the
        same branch.
      </p>
      <form action={submitFeedback}>
        <input type="hidden" name="task_id" value={taskId} />
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
          <li key={run.id}>
            <Link href={`/assembly-runs/${run.id}`}>
              #{run.id.substring(0, 8)}
            </Link>{" "}
            —{" "}
            <span className={`op-badge op-${run.status}`}>
              {formatEnumLabel(run.outcome ?? run.status)}
            </span>{" "}
            · started <TimeAgo date={run.created_at} inline />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function TaskDetailView({
  task,
  failedEvent,
  runs = [],
  submitFeedback,
}: TaskDetailViewProps) {
  return (
    <TaskRefreshProvider taskId={task.id} taskStatus={task.status} runs={runs}>
      <div>
        <h1>Task: {task.description.substring(0, 80)}</h1>
        <div className="spec-card">
          <p>
            <strong>Type:</strong>{" "}
            <span className="badge">{task.task_type}</span>
          </p>
          <p>
            <strong>Status:</strong>{" "}
            <span className={`op-badge op-${task.status}`}>
              {formatEnumLabel(task.status)}
            </span>
          </p>
          <p>
            <strong>Priority:</strong>{" "}
            <PriorityBadge priority={task.priority} />
          </p>
          <p>
            <strong>Repo:</strong> {task.target_repo}
          </p>
          <p>
            <strong>Description:</strong>{" "}
            <Linkified text={task.description} repo={task.target_repo} />
          </p>
          <AgentRow agentId={task.agent_id} />
          <PrLinkRow prUrl={task.pr_url} />
          <PrStatusSection
            taskId={task.id}
            prUrl={task.pr_url}
            prNumber={task.pr_number}
          />
          <FailureRow
            failureReason={task.failure_reason}
            repo={task.target_repo}
          />
          <ReviewIterationsRow reviewIteration={task.review_iteration} />
          <p>
            <strong>Created by:</strong> {task.created_by}
          </p>
          <p className="meta">
            Created: <TimeAgo date={task.created_at} inline /> · Updated:{" "}
            <TimeAgo date={task.updated_at} inline />
          </p>
          <div className={styles.actions}>
            <RunNowAction
              taskId={task.id}
              status={task.status}
              priority={task.priority}
            />
            <CancelAction taskId={task.id} status={task.status} />
          </div>
        </div>

        <TaskFailurePanel
          status={task.status}
          failedEvent={failedEvent}
          repo={task.target_repo}
        />

        <FeedbackSection
          taskId={task.id}
          prUrl={task.pr_url}
          status={task.status}
          submitFeedback={submitFeedback}
        />

        <RunsSection runs={runs} />
      </div>
    </TaskRefreshProvider>
  );
}
