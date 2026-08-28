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

/** With exactly one attempt the run page IS the detail — return its href.
 *  Zero or several attempts keep the lifecycle shell with its runs list. */
export function soleRunHref(runs: TaskRunRow[]): string | null {
  return runs.length === 1 ? `/assembly-runs/${runs[0].id}` : null;
}

export interface TaskDetailViewProps {
  task: TaskDetailTask;
  failedEvent: TaskDetailEvent | undefined;
  runs?: TaskRunRow[];
  submitFeedback: (formData: FormData) => void | Promise<void>;
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
            <span
              className={
                task.priority === "immediate" ? "badge badge-red" : "meta"
              }
            >
              {task.priority || "normal"}
            </span>
          </p>
          <p>
            <strong>Repo:</strong> {task.target_repo}
          </p>
          <p>
            <strong>Description:</strong>{" "}
            <Linkified text={task.description} repo={task.target_repo} />
          </p>
          {task.agent_id && (
            <p>
              <strong>Agent:</strong> {task.agent_id}
            </p>
          )}
          {task.pr_url && (
            <p>
              <strong>PR:</strong>{" "}
              <a href={task.pr_url} target="_blank">
                {task.pr_url}
              </a>
            </p>
          )}
          {task.pr_url && task.pr_number && (
            <PRStatusPanel taskId={task.id} prUrl={task.pr_url} />
          )}
          {task.failure_reason && (
            <p>
              <strong>Failure:</strong>{" "}
              <span className={styles.failureText}>
                <Linkified text={task.failure_reason} repo={task.target_repo} />
              </span>
            </p>
          )}
          {task.review_iteration > 0 && (
            <p>
              <strong>Review iterations:</strong> {task.review_iteration}
            </p>
          )}
          <p>
            <strong>Created by:</strong> {task.created_by}
          </p>
          <p className="meta">
            Created: <TimeAgo date={task.created_at} inline /> · Updated:{" "}
            <TimeAgo date={task.updated_at} inline />
          </p>
          <div className={styles.actions}>
            {task.status === "pending" &&
              (task.priority || "normal") === "normal" && (
                <form action={`/api/tasks/${task.id}/run-now`} method="POST">
                  <button type="submit" className={styles.runNowBtn}>
                    Run Now
                  </button>
                </form>
              )}
            {isCancellable(task.status) && (
              <CancelTaskButton taskId={task.id} />
            )}
          </div>
        </div>

        {task.status === "failed" && failedEvent?.metadata && (
          <FailurePanel
            metadata={failedEvent.metadata}
            repo={task.target_repo}
          />
        )}

        {/* Feedback form — visible when task has a PR and isn't in a terminal state */}
        {task.pr_url && !["merged", "cancelled"].includes(task.status) && (
          <div className={`spec-card ${styles.feedbackCard}`}>
            <h3 className={styles.feedbackHeading}>Give Feedback</h3>
            <p className={`meta ${styles.feedbackLede}`}>
              Tell the agent what to change. A revision task will be created on
              the same branch.
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

        {runs.length > 0 && (
          <section>
            <h2>Runs</h2>
            <p className="meta">
              Each execution attempt of this task (a retry mints a new run).
              Open one for its timeline, transcript, and pod logs.
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
        )}
      </div>
    </TaskRefreshProvider>
  );
}
