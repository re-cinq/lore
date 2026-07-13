// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AssemblyLineListView from "./AssemblyLineListView";
import {
  groupTasksIntoAssemblyLines,
  type AssemblyLineTaskRow,
} from "@/lib/assembly-lines";

const taskRow = (over: Partial<AssemblyLineTaskRow>): AssemblyLineTaskRow => ({
  id: "task-abcd1234",
  description: "Implement the widget end to end",
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
  ...over,
});

describe("AssemblyLineListView", () => {
  it("renders the heading and the Create Task link", () => {
    render(<AssemblyLineListView runs={[]} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Assembly Lines" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ Create Task" })).toHaveAttribute(
      "href",
      "/assembly-lines/create",
    );
  });

  it("marks All active and links every rolled-up status filter when none is selected", () => {
    render(<AssemblyLineListView runs={[]} />);
    const all = screen.getByRole("link", { name: "All" });

    expect(all).toHaveAttribute("href", "/assembly-lines");
    expect(all).toHaveClass("active");

    const labels: [string, string][] = [
      ["Running", "running"],
      ["PR created", "pr-created"],
      ["In review", "review"],
      ["Merged", "merged"],
      ["Failed", "failed"],
      ["Needs human", "needs-human"],
      ["Pending", "pending"],
    ];

    for (const [label, key] of labels) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        `/assembly-lines?status=${key}`,
      );
    }
  });

  it("marks the matching filter active and not All when a status is selected", () => {
    render(<AssemblyLineListView activeStatus="failed" runs={[]} />);
    expect(screen.getByRole("link", { name: "All" })).not.toHaveClass("active");
    expect(screen.getByRole("link", { name: "Failed" })).toHaveClass("active");
    expect(screen.getByRole("link", { name: "Running" })).not.toHaveClass(
      "active",
    );
  });

  it("renders the runs through the shared table", () => {
    const runs = groupTasksIntoAssemblyLines([
      taskRow({ id: "task-abcd1234" }),
    ]);

    render(<AssemblyLineListView runs={runs} />);
    expect(screen.getByRole("link", { name: "#task-abc" })).toHaveAttribute(
      "href",
      "/assembly-lines/task-abcd1234",
    );
  });
});
