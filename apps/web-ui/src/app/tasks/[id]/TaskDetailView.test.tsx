// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TaskDetailView, {
  soleRunHref,
  type TaskDetailTask,
  type TaskDetailEvent,
} from "./TaskDetailView";

const task = (over: Partial<TaskDetailTask> = {}): TaskDetailTask => ({
  id: "task-1",
  description: "Implement the widget",
  task_type: "implementation",
  status: "running",
  priority: "normal",
  target_repo: "re-cinq/lore",
  target_branch: "feature/widget",
  agent_id: null,
  pr_url: null,
  pr_number: null,
  review_iteration: 0,
  failure_reason: null,
  created_by: "alice",
  created_at: "2026-06-01T10:00:00Z",
  updated_at: "2026-06-01T11:00:00Z",
  ...over,
});

const event = (over: Partial<TaskDetailEvent> = {}): TaskDetailEvent => ({
  id: "evt-1",
  task_id: "task-1",
  from_status: "pending",
  to_status: "running",
  metadata: null,
  created_at: "2026-06-01T10:30:00Z",
  ...over,
});

const action = vi.fn();

const renderView = (
  over: Partial<React.ComponentProps<typeof TaskDetailView>> = {},
) =>
  render(
    <TaskDetailView
      task={task()}
      failedEvent={undefined}
      submitFeedback={action}
      {...over}
    />,
  );

describe("TaskDetailView", () => {
  it("lists the task's run attempts, each linking to its run detail", () => {
    renderView({
      runs: [
        {
          id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          status: "finished",
          outcome: "pr_created",
          created_at: "2026-07-14T10:00:00Z",
        },
      ],
    });

    expect(
      screen.getByRole("heading", { level: 2, name: "Runs" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#aaaaaaaa" })).toHaveAttribute(
      "href",
      "/assembly-runs/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    );
  });

  it("shows each run's outcome as a status-classed badge with its start time", () => {
    const { container } = renderView({
      runs: [
        {
          id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          status: "finished",
          outcome: "pr_created",
          created_at: "2026-07-14T10:00:00Z",
        },
        {
          id: "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          status: "failed",
          outcome: null,
          created_at: "2026-07-14T09:00:00Z",
        },
      ],
    });

    expect(container.querySelector(".op-badge.op-finished")).toHaveTextContent(
      "PR created",
    );
    expect(container.querySelector(".op-badge.op-failed")).toHaveTextContent(
      "Failed",
    );
  });

  it("omits the Runs section when the task has no run rows", () => {
    renderView({ runs: [] });

    expect(
      screen.queryByRole("heading", { level: 2, name: "Runs" }),
    ).not.toBeInTheDocument();
  });

  it("renders the truncated description heading and core task fields", () => {
    renderView({
      task: task({
        task_type: "implementation",
        target_repo: "re-cinq/lore",
        created_by: "alice",
      }),
    });
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Task: Implement the widget",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("implementation")).toBeInTheDocument();
    expect(screen.getByText("re-cinq/lore")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("sentence-cases the header status badge", () => {
    const { container } = renderView({ task: task({ status: "running" }) });

    expect(container.querySelector(".op-badge.op-running")).toHaveTextContent(
      "Running",
    );
  });

  it("truncates a description longer than 80 characters in the heading", () => {
    const long = "x".repeat(120);

    renderView({ task: task({ description: long }) });
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: `Task: ${"x".repeat(80)}`,
      }),
    ).toBeInTheDocument();
  });

  it("shows priority as a red badge when immediate", () => {
    renderView({ task: task({ priority: "immediate" }) });
    const badge = screen.getByText("immediate");

    expect(badge).toHaveClass("badge", "badge-red");
  });

  it("falls back to normal priority label and meta class when priority is empty", () => {
    renderView({ task: task({ priority: "" }) });
    const badge = screen.getByText("normal");

    expect(badge).toHaveClass("meta");
  });

  it("renders the Run Now form only for pending normal-priority tasks", () => {
    const { container } = renderView({
      task: task({ status: "pending", priority: "normal" }),
    });

    expect(screen.getByRole("button", { name: "Run Now" })).toBeInTheDocument();
    expect(
      container.querySelector('form[action="/api/tasks/task-1/run-now"]'),
    ).toBeTruthy();
  });

  it("hides the Run Now form for immediate-priority pending tasks", () => {
    renderView({ task: task({ status: "pending", priority: "immediate" }) });
    expect(
      screen.queryByRole("button", { name: "Run Now" }),
    ).not.toBeInTheDocument();
  });

  it("renders the Cancel Task control for non-terminal tasks", () => {
    renderView({ task: task({ status: "running" }) });
    // The confirm-gated submit form lives in CancelTaskButton (tested there);
    // here we only assert the trigger is present for a cancellable task.
    expect(
      screen.getByRole("button", { name: "Cancel Task" }),
    ).toBeInTheDocument();
  });

  it("hides the Cancel Task form for merged tasks", () => {
    renderView({
      task: task({
        status: "merged",
        pr_url: "https://example.com/pr/1",
        pr_number: 1,
      }),
    });
    expect(
      screen.queryByRole("button", { name: "Cancel Task" }),
    ).not.toBeInTheDocument();
  });

  it("hides the Cancel Task form for completed tasks", () => {
    renderView({ task: task({ status: "completed" }) });
    expect(
      screen.queryByRole("button", { name: "Cancel Task" }),
    ).not.toBeInTheDocument();
  });

  it("renders the agent row only when an agent is assigned", () => {
    renderView({ task: task({ agent_id: "agent-42" }) });
    expect(screen.getByText("Agent:")).toBeInTheDocument();
    expect(screen.getByText("agent-42")).toBeInTheDocument();
  });

  it("omits the agent row when no agent is assigned", () => {
    renderView({ task: task({ agent_id: null }) });
    expect(screen.queryByText("Agent:")).not.toBeInTheDocument();
  });

  it("renders the PR link and PR status card when a PR exists", () => {
    renderView({
      task: task({
        pr_url: "https://github.com/re-cinq/lore/pull/7",
        pr_number: 7,
      }),
    });
    const link = screen.getByRole("link", {
      name: "https://github.com/re-cinq/lore/pull/7",
    });

    expect(link).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/pull/7",
    );
  });

  it("renders the failure row when a failure reason is present", () => {
    renderView({ task: task({ failure_reason: "lint failed" }) });
    expect(screen.getByText("Failure:")).toBeInTheDocument();
    expect(screen.getByText("lint failed")).toBeInTheDocument();
  });

  it("renders the review iterations row only when greater than zero", () => {
    renderView({ task: task({ review_iteration: 2 }) });
    expect(screen.getByText("Review iterations:")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("omits the review iterations row when zero", () => {
    renderView({ task: task({ review_iteration: 0 }) });
    expect(screen.queryByText("Review iterations:")).not.toBeInTheDocument();
  });

  it("renders the FailurePanel when the task failed and a failed event carries metadata", () => {
    const failed = event({
      to_status: "failed",
      metadata: { error: "agent crashed mid-run" },
    });

    renderView({
      task: task({ status: "failed" }),
      failedEvent: failed,
    });
    expect(
      screen.getByRole("heading", { level: 3, name: "Failure" }),
    ).toBeInTheDocument();
    expect(screen.getByText("agent crashed mid-run")).toBeInTheDocument();
  });

  it("does not render the FailurePanel when there is no failed event metadata", () => {
    renderView({ task: task({ status: "running" }), failedEvent: undefined });
    expect(
      screen.queryByRole("heading", { level: 3, name: "Failure" }),
    ).not.toBeInTheDocument();
  });

  it("wires the feedback form to the injected action with a hidden task_id", () => {
    const { container } = renderView({
      task: task({
        pr_url: "https://github.com/re-cinq/lore/pull/7",
        pr_number: 7,
        status: "running",
      }),
    });

    expect(
      screen.getByRole("heading", { level: 3, name: "Give Feedback" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Request Revision" }),
    ).toBeInTheDocument();
    expect(container.querySelector('input[name="task_id"]')).toHaveValue(
      "task-1",
    );
    expect(container.querySelector('textarea[name="feedback"]')).toBeTruthy();
  });

  it("hides the feedback form when the task has no PR", () => {
    renderView({ task: task({ pr_url: null }) });
    expect(
      screen.queryByRole("heading", { level: 3, name: "Give Feedback" }),
    ).not.toBeInTheDocument();
  });

  it("hides the feedback form for cancelled tasks even with a PR", () => {
    renderView({
      task: task({
        pr_url: "https://example.com/pr/1",
        pr_number: 1,
        status: "cancelled",
      }),
    });
    expect(
      screen.queryByRole("button", { name: "Request Revision" }),
    ).not.toBeInTheDocument();
  });

  it("does not render an execution transcript, event timeline, or LLM-call table", () => {
    renderView();
    expect(
      screen.queryByRole("heading", { name: "Event Timeline" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "LLM Calls" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Agent Output" }),
    ).not.toBeInTheDocument();
  });
});

describe("soleRunHref", () => {
  const run = (id: string) => ({
    id,
    status: "finished" as const,
    outcome: null,
    created_at: "2026-07-14T10:00:00Z",
  });

  it("returns the run's href when the task has exactly one run", () => {
    expect(soleRunHref([run("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")])).toEqual(
      "/assembly-runs/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    );
  });

  it("returns null for zero runs", () => {
    expect(soleRunHref([])).toBeNull();
  });

  it("returns null for two runs", () => {
    expect(soleRunHref([run("run-1"), run("run-2")])).toBeNull();
  });
});
