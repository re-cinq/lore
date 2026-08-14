import Link from "next/link";
import PRStatusPanel from "./PRStatusPanel";
import TaskRefreshProvider from "./TaskRefreshProvider";
import { CancelTaskButton } from "./CancelTaskButton";
import TaskLogs from "./TaskLogs";
import TimelinePanel from "./TimelinePanel";
import FailurePanel from "./FailurePanel";
import EventTimeline from "./EventTimeline";
import LlmCallsTable from "./LlmCallsTable";
import Linkified from "@/components/Linkified";
import { isCancellable } from "@/lib/task-status";
import { TimeAgo } from "@/components/TimeAgo";
import { formatEnumLabel } from "@/lib/enum-label";
import type { TaskRuntimeEvent, TaskRuntimeLlmCall } from "@/lib/task-runtime";
import styles from "./TaskDetailView.module.css";

export interface TaskDetailTask {
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

export type TaskDetailEvent = TaskRuntimeEvent;
export type TaskDetailLlmCall = TaskRuntimeLlmCall;

/** One per-attempt run row (pipeline.assembly_runs) backing this task. */
export interface TaskRunRow {
  id: string;
  status: string;
  outcome: string | null;
  created_at: string;
}

export interface TaskDetailViewProps {
  task: TaskDetailTask;
  events: TaskDetailEvent[];
  llmCalls: TaskDetailLlmCall[];
  failedEvent: TaskDetailEvent | undefined;
  runs?: TaskRunRow[];
  submitFeedback: (formData: FormData) => void | Promise<void>;
}

export default function TaskDetailView({
  task,
  events,
  llmCalls,
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
              Open one for its per-node timeline.
            </p>
            <ul>
              {runs.map((run) => (
                <li key={run.id}>
                  <Link href={`/assembly-lines/${run.id}`}>
                    #{run.id.substring(0, 8)}
                  </Link>{" "}
                  — {run.outcome ?? run.status}
                </li>
              ))}
            </ul>
          </section>
        )}

        <TimelinePanel taskId={task.id} initialStatus={task.status} />

        <TaskLogs taskId={task.id} initialStatus={task.status} />

        <EventTimeline events={events} />

        <LlmCallsTable llmCalls={llmCalls} repo={task.target_repo} />
      </div>
    </TaskRefreshProvider>
  );
}
