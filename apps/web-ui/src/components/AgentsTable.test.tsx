// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import AgentsTable, { type AgentRow } from "./AgentsTable";

const local = (over: Partial<AgentRow> = {}): AgentRow => ({
  agent_id: "a50f9f29-local",
  kind: "local",
  task_count: 0,
  memory_count: 7,
  cost_usd: 0,
  created_by: null,
  last_active: "2026-06-01T12:00:00.000Z",
  ...over,
});

const task = (over: Partial<AgentRow> = {}): AgentRow => ({
  agent_id: "lore-agent-abc123",
  kind: "task",
  task_count: 3,
  memory_count: 0,
  cost_usd: 0.1234,
  created_by: "bogdan",
  last_active: "2026-06-02T12:00:00.000Z",
  reason_type: "implementation",
  reason: "Implement the widget",
  ...over,
});

describe("AgentsTable rendering", () => {
  it("renders the heading, help popover and optional intro", () => {
    render(<AgentsTable agents={[]} intro="All agents across the org." />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Agents" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What agents are" }),
    ).toBeInTheDocument();
    expect(screen.getByText("All agents across the org.")).toBeInTheDocument();
  });

  it("omits the intro line when no intro is given", () => {
    const { container } = render(<AgentsTable agents={[local()]} />);
    expect(container.querySelector("p.meta")).toBeNull();
  });

  it("renders a custom heading title", () => {
    render(<AgentsTable agents={[]} title="Sessions" />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Sessions" }),
    ).toBeInTheDocument();
  });

  it("drops the heading, help popover and intro when embedded but keeps the table", () => {
    render(<AgentsTable agents={[]} embedded intro="ignored when embedded" />);
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "What agents are" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("ignored when embedded")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("renders the base column headers without a Why column when no reason is present", () => {
    render(<AgentsTable agents={[local()]} />);
    const table = screen.getByRole("table");
    for (const header of [
      "Agent",
      "Type",
      "Created by",
      "Tasks",
      "Cost",
      "Memories",
      "Last Active",
    ]) {
      expect(
        within(table).getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
    expect(
      within(table).queryByRole("columnheader", { name: "Why" }),
    ).not.toBeInTheDocument();
  });

  it("renders the Why column with a reason badge and truncated text when a reason is present", () => {
    render(
      <AgentsTable
        agents={[
          task({ task_count: 0, kind: "local", reason: "x".repeat(80) }),
          local({
            agent_id: "a50f9f29-two",
            reason: "no type here",
            reason_type: null,
          }),
        ]}
      />,
    );
    const table = screen.getByRole("table");
    expect(
      within(table).getByRole("columnheader", { name: "Why" }),
    ).toBeInTheDocument();
    expect(screen.getByText("implementation")).toHaveClass("badge");
    expect(screen.getByText("x".repeat(50) + "…")).toBeInTheDocument();
    // The second row carries a reason but no reason_type, so no badge renders for it.
    expect(screen.getByText("no type here")).toBeInTheDocument();
  });
});

describe("AgentsTable local-vs-task visibility", () => {
  it("shows only local agents by default and hides task agents behind the toggle", () => {
    render(<AgentsTable agents={[local(), task()]} />);
    expect(
      screen.getByRole("link", { name: "a50f9f29-local" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "lore-agent-abc123" }),
    ).not.toBeInTheDocument();
  });

  it("labels the toggle with the hidden task-agent count", () => {
    render(
      <AgentsTable
        agents={[local(), task(), task({ agent_id: "lore-agent-def456" })]}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "Show task agents (audit) — 2 hidden",
      }),
    ).toBeInTheDocument();
  });

  it("reveals task agents and flips the label when the toggle is clicked", () => {
    render(<AgentsTable agents={[local(), task()]} />);
    const toggle = screen.getByRole("button", { name: /Show task agents/ });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    expect(
      screen.getByRole("link", { name: "lore-agent-abc123" }),
    ).toBeInTheDocument();
    const hide = screen.getByRole("button", { name: "Hide task agents" });
    expect(hide).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(hide);
    expect(
      screen.queryByRole("link", { name: "lore-agent-abc123" }),
    ).not.toBeInTheDocument();
  });

  it("renders no toggle when there are no task agents", () => {
    render(<AgentsTable agents={[local()]} />);
    expect(
      screen.queryByRole("button", { name: /task agents/ }),
    ).not.toBeInTheDocument();
  });
});

describe("AgentsTable rows", () => {
  it("renders the kind badge, encoded link, counts and cost per row", () => {
    render(
      <AgentsTable
        agents={[local({ agent_id: "agent x/1", memory_count: 99 })]}
      />,
    );
    const link = screen.getByRole("link", { name: "agent x/1" });
    expect(link).toHaveAttribute("href", "/agents/agent%20x%2F1");
    expect(screen.getByText("Local MCP")).toHaveClass("badge");

    const table = screen.getByRole("table");
    expect(within(table).getByText("99")).toBeInTheDocument();
    expect(within(table).getByText("$0.0000")).toBeInTheDocument();
  });

  it("renders the Task badge and four-decimal cost for a revealed task agent", () => {
    render(<AgentsTable agents={[task({ cost_usd: 1.5 })]} />);
    fireEvent.click(screen.getByRole("button", { name: /Show task agents/ }));
    expect(screen.getByText("Task")).toHaveClass("badge");
    expect(screen.getByText("$1.5000")).toBeInTheDocument();
  });

  it("falls back to unknown creator and an em dash when last_active is null", () => {
    render(
      <AgentsTable agents={[local({ created_by: null, last_active: null })]} />,
    );
    expect(screen.getByText("unknown")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("AgentsTable empty states", () => {
  it("shows the empty-state row when there are no agents", () => {
    render(<AgentsTable agents={[]} />);
    expect(screen.getByText("No agents yet")).toBeInTheDocument();
  });

  it("shows the empty-state row when only hidden task agents exist", () => {
    render(<AgentsTable agents={[task()]} />);
    expect(screen.getByText("No agents yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show task agents/ }));
    expect(screen.queryByText("No agents yet")).not.toBeInTheDocument();
  });
});
