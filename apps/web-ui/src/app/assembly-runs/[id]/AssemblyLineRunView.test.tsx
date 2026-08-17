// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AssemblyLineRunView from "./AssemblyLineRunView";
import type { AssemblyLineRun } from "@/lib/assembly-line-runs";

const run = (over: Partial<AssemblyLineRun> = {}): AssemblyLineRun => ({
  id: "al-1",
  blueprintName: "code-review",
  graph: null,
  taskId: null,
  repo: "re-cinq/lore",
  branch: "feat/x",
  status: "finished",
  outcome: "completed",
  reason: null,
  createdAt: "2026-07-14T10:00:00Z",
  startedAt: "2026-07-14T10:00:05Z",
  durationSeconds: 120,
  prUrl: "https://github.com/re-cinq/lore/pull/7",
  prNumber: 7,
  createdBy: null,
  costUsd: null,
  ...over,
});

describe("AssemblyLineRunView", () => {
  it("renders the run header with definition, repo link and outcome", () => {
    render(<AssemblyLineRunView run={run()} />);

    expect(
      screen.getByRole("heading", { name: "code-review", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "re-cinq/lore" })).toHaveAttribute(
      "href",
      "/repos/re-cinq/lore",
    );
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("shows the reason on a failed run", () => {
    render(
      <AssemblyLineRunView
        run={run({ status: "failed", outcome: "error", reason: "no edge" })}
      />,
    );

    expect(screen.getByText("no edge")).toBeInTheDocument();
  });

  it("links the backing task when task_id is set, omits it otherwise", () => {
    const { rerender } = render(
      <AssemblyLineRunView run={run({ taskId: "task-9" })} />,
    );

    expect(screen.getByRole("link", { name: "View task →" })).toHaveAttribute(
      "href",
      "/tasks/task-9",
    );

    rerender(<AssemblyLineRunView run={run({ taskId: null })} />);
    expect(
      screen.queryByRole("link", { name: "View task →" }),
    ).not.toBeInTheDocument();
  });

  it("builds the PR link for a code-review run with no task", () => {
    render(<AssemblyLineRunView run={run()} />);

    expect(screen.getByRole("link", { name: "#7" })).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/pull/7",
    );
  });
});
