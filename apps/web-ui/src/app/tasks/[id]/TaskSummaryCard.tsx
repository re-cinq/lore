import PRStatusPanel from "./PRStatusPanel";
import { CancelTaskButton } from "./CancelTaskButton";
import Linkified from "@/components/Linkified";
import { isCancellable } from "@/lib/task-status";
import { TimeAgo } from "@/components/TimeAgo";
import { formatEnumLabel } from "@/lib/enum-label";
import type { TaskDetailTask } from "./TaskDetailView";
import styles from "./TaskDetailView.module.css";

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

function StatusFact({ status }: { status: string }) {
  return (
    <p>
      <strong>Status:</strong>{" "}
      <span className={`op-badge op-${status}`}>{formatEnumLabel(status)}</span>
    </p>
  );
}

function DescriptionFact({ task }: { task: TaskDetailTask }) {
  return (
    <p>
      <strong>Description:</strong>{" "}
      <Linkified text={task.description} repo={task.target_repo} />
    </p>
  );
}

/** The task as it was asked for: what kind of work, where it landed, what it says. Everything here comes from the request itself, so none of it changes while the task runs. */
function TaskFacts({ task }: { task: TaskDetailTask }) {
  return (
    <>
      <p>
        <strong>Type:</strong> <span className="badge">{task.task_type}</span>
      </p>
      <StatusFact status={task.status} />
      <p>
        <strong>Priority:</strong> <PriorityBadge priority={task.priority} />
      </p>
      <p>
        <strong>Repo:</strong> {task.target_repo}
      </p>
      <DescriptionFact task={task} />
    </>
  );
}

/** The two things a reader can do to a task from here. Each decides for itself whether it applies to this status, so neither is conditional at this level. */
function TaskActions({ task }: { task: TaskDetailTask }) {
  return (
    <div className={styles.actions}>
      <RunNowAction
        taskId={task.id}
        status={task.status}
        priority={task.priority}
      />
      <CancelAction taskId={task.id} status={task.status} />
    </div>
  );
}

/** Who asked and when. The two timestamps sit together because the pair is the reading: an update long after creation is the interesting case. */
function CreationFacts({ task }: { task: TaskDetailTask }) {
  return (
    <>
      <p>
        <strong>Created by:</strong> {task.created_by}
      </p>
      <p className="meta">
        Created: <TimeAgo date={task.created_at} inline /> · Updated:{" "}
        <TimeAgo date={task.updated_at} inline />
      </p>
    </>
  );
}

/** Everything true of the task itself, above the panels that report on its run. */
export default function TaskSummaryCard({ task }: { task: TaskDetailTask }) {
  return (
    <div className="spec-card">
      <TaskFacts task={task} />
      <AgentRow agentId={task.agent_id} />
      <PrLinkRow prUrl={task.pr_url} />
      <PrStatusSection
        taskId={task.id}
        prUrl={task.pr_url}
        prNumber={task.pr_number}
      />
      <FailureRow failureReason={task.failure_reason} repo={task.target_repo} />
      <ReviewIterationsRow reviewIteration={task.review_iteration} />
      <CreationFacts task={task} />
      <TaskActions task={task} />
    </div>
  );
}
