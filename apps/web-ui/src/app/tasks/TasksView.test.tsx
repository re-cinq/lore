// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import TasksView from "./TasksView";

const task = (over: Record<string, unknown> = {}) => ({
  id: "task-1",
  content: "Do the thing",
  content_type: "task",
  metadata: { status: "open" },
  ingested_at: "2026-06-01T10:00:00.000Z",
  ...over,
});

const entry = (over: Record<string, unknown> = {}) => ({
  agent_id: "agent-7",
  operation: "write_memory",
  memory_key: "deployment-gotchas",
  metadata: {},
  created_at: "2026-06-02T08:30:00.000Z",
  ...over,
});

describe("TasksView", () => {
  it("renders the heading and global-view notice", () => {
    const action = vi.fn();
    render(<TasksView tasks={[]} recentActivity={[]} createTask={action} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Tasks" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This is the global view across all repos/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Repositories" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("wires the Create-Task form to the injected action with required textarea", () => {
    const action = vi.fn();
    const { container } = render(
      <TasksView tasks={[]} recentActivity={[]} createTask={action} />,
    );
    expect(
      screen.getByRole("button", { name: "Create Task" }),
    ).toBeInTheDocument();
    const textarea = container.querySelector('textarea[name="description"]');
    expect(textarea).toBeInTheDocument();
    expect(textarea).toBeRequired();
  });

  it("shows both task empty state and activity empty state when nothing is populated", () => {
    const action = vi.fn();
    render(<TasksView tasks={[]} recentActivity={[]} createTask={action} />);
    expect(
      screen.getByText("No tasks found. Create one above."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No recent agent activity recorded."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders one card per task with the badge-open class on open status", () => {
    const action = vi.fn();
    render(
      <TasksView
        tasks={[
          task({ id: "a", content: "Open task", metadata: { status: "open" } }),
        ]}
        recentActivity={[]}
        createTask={action}
      />,
    );
    const badge = screen.getByText("open");
    expect(badge).toHaveClass("badge", "badge-open");
    expect(screen.getByText("Open task")).toBeInTheDocument();
  });

  it("renders unknown status without badge-open when metadata has no status", () => {
    const action = vi.fn();
    render(
      <TasksView
        tasks={[task({ id: "b", content: "Stateless task", metadata: {} })]}
        recentActivity={[]}
        createTask={action}
      />,
    );
    const badge = screen.getByText("unknown");
    expect(badge).toHaveClass("badge");
    expect(badge).not.toHaveClass("badge-open");
    expect(screen.getByText("Stateless task")).toBeInTheDocument();
  });

  it("renders the activity table with one row per audit entry", () => {
    const action = vi.fn();
    render(
      <TasksView
        tasks={[]}
        recentActivity={[
          entry({
            agent_id: "agent-1",
            operation: "read_memory",
            memory_key: "k1",
          }),
          entry({
            agent_id: "agent-2",
            operation: "delete_memory",
            memory_key: "k2",
          }),
        ]}
        createTask={action}
      />,
    );
    const table = screen.getByRole("table");
    expect(within(table).getByText("agent-1")).toBeInTheDocument();
    expect(within(table).getByText("agent-2")).toBeInTheDocument();
    expect(within(table).getByText("read_memory")).toBeInTheDocument();
    expect(within(table).getByText("delete_memory")).toBeInTheDocument();
    expect(within(table).getByText("k1")).toBeInTheDocument();
    expect(within(table).getByText("k2")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(3);
  });
});
