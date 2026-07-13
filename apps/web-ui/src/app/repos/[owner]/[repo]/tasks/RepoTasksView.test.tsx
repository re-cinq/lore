// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RepoTasksView from "./RepoTasksView";
import {
  groupTasksIntoAssemblyLines,
  type AssemblyLineTaskRow,
} from "@/lib/assembly-lines";

const taskRow = (over: Partial<AssemblyLineTaskRow>): AssemblyLineTaskRow => ({
  id: "task-abcd1234",
  description: "Implement the widget",
  task_type: "implementation",
  status: "running",
  priority: "normal",
  target_repo: "re-cinq/lore",
  agent_id: "agent-abc",
  pr_url: null,
  pr_number: null,
  target_branch: null,
  parent_task_id: null,
  retry_of: null,
  created_by: "bogdan",
  created_at: "2026-06-01T12:00:00.000Z",
  updated_at: "2026-06-01T12:00:00.000Z",
  cost_usd: 0,
  ...over,
});

const group = (...rows: AssemblyLineTaskRow[]) =>
  groupTasksIntoAssemblyLines(rows);

describe("RepoTasksView", () => {
  it("renders the Assembly Lines heading, intro copy and New Task link", () => {
    render(<RepoTasksView owner="re-cinq" repo="lore" runs={[]} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Assembly Lines" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Assembly lines targeting this repo/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ New Task" })).toHaveAttribute(
      "href",
      "/repos/re-cinq/lore/tasks/create",
    );
  });

  it("renders the empty-state row when there are no runs", () => {
    render(<RepoTasksView owner="re-cinq" repo="lore" runs={[]} />);
    expect(screen.getByText("No assembly lines")).toBeInTheDocument();
  });

  it("renders a run with its stage mini-graph and a summed cost column", () => {
    const impl = taskRow({
      id: "task-abcd1234",
      target_branch: "lore/x",
      cost_usd: 0.3,
      created_at: "2026-06-01T10:00:00.000Z",
    });
    const review = taskRow({
      id: "review",
      task_type: "review",
      parent_task_id: "task-abcd1234",
      target_branch: "lore/x",
      cost_usd: 0.2,
      created_at: "2026-06-01T11:00:00.000Z",
    });
    render(
      <RepoTasksView owner="re-cinq" repo="lore" runs={group(review, impl)} />,
    );

    expect(screen.getByRole("link", { name: "#task-abc" })).toHaveAttribute(
      "href",
      "/assembly-lines/task-abcd1234",
    );
    expect(screen.getAllByTestId("al-stage")).toHaveLength(2);
    expect(screen.getByText("Cost")).toBeInTheDocument();
    expect(screen.getByText("$0.5000")).toBeInTheDocument();
  });
});
