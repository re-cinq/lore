// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AssemblyRunView from "./AssemblyRunView";
import type { AssemblyRun } from "@/lib/assembly-runs";

const run = (over: Partial<AssemblyRun> = {}): AssemblyRun => ({
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
  issueUrl: "https://github.com/re-cinq/lore/issues/5",
  issueNumber: 5,
  createdBy: null,
  costUsd: null,
  ...over,
});

describe("AssemblyRunView", () => {
  it("renders the run header with its line name and outcome", () => {
    render(<AssemblyRunView run={run()} />);

    expect(
      screen.getByRole("heading", { name: "code-review", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("names the repo once, in the trail, rather than repeating it as a fact", () => {
    render(<AssemblyRunView run={run()} />);

    expect(screen.getAllByRole("link", { name: "re-cinq/lore" })).toHaveLength(
      1,
    );
  });

  it("shows the reason on a failed run", () => {
    render(
      <AssemblyRunView
        run={run({ status: "failed", outcome: "error", reason: "no edge" })}
      />,
    );

    expect(screen.getByText("no edge")).toBeInTheDocument();
  });

  it("links the backing task when task_id is set, omits it otherwise", () => {
    const { rerender } = render(
      <AssemblyRunView run={run({ taskId: "task-9" })} />,
    );

    expect(screen.getByRole("link", { name: "View task →" })).toHaveAttribute(
      "href",
      "/tasks/task-9",
    );

    rerender(<AssemblyRunView run={run({ taskId: null })} />);
    expect(
      screen.queryByRole("link", { name: "View task →" }),
    ).not.toBeInTheDocument();
  });

  it("builds the PR link for a code-review run with no task", () => {
    render(<AssemblyRunView run={run()} />);

    expect(screen.getByRole("link", { name: "#7" })).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/pull/7",
    );
  });

  it("shows an em dash for branch and outcome when both are null", () => {
    render(<AssemblyRunView run={run({ branch: null, outcome: null })} />);

    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("omits the PR link when the run carries no PR", () => {
    render(<AssemblyRunView run={run({ prUrl: null, prNumber: null })} />);

    expect(screen.queryByRole("link", { name: "#7" })).not.toBeInTheDocument();
  });
  it("renders the run facts inside a spec-card", () => {
    const { container } = render(<AssemblyRunView run={run()} />);

    expect(container.querySelector(".spec-card > dl")).toBeInTheDocument();
  });

  it("links the backing task's GitHub issue under the PR", () => {
    render(<AssemblyRunView run={run()} />);

    expect(screen.getByRole("link", { name: "#5" })).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/issues/5",
    );
  });

  it("omits the issue link when the run carries no issue", () => {
    render(
      <AssemblyRunView run={run({ issueUrl: null, issueNumber: null })} />,
    );

    expect(screen.queryByRole("link", { name: "#5" })).not.toBeInTheDocument();
  });

  it("trails the run back to the runs list and its repo above the title", () => {
    const { container } = render(<AssemblyRunView run={run()} />);
    const trail = container.querySelector(".breadcrumb");

    expect(
      Array.from(trail?.querySelectorAll("a") ?? []).map((a) =>
        a.getAttribute("href"),
      ),
    ).toEqual(["/assembly-runs", "/repos/re-cinq/lore"]);
  });

  it("ends the trail with the run's own line name", () => {
    const { container } = render(<AssemblyRunView run={run()} />);

    expect(container.querySelector(".breadcrumb")).toHaveTextContent(
      "Assembly Runs / re-cinq/lore / code-review",
    );
  });
  it("steps through the repo's backlog for a run the implementation loop started", () => {
    const { container } = render(
      <AssemblyRunView run={run({ blueprintName: "implementation-loop" })} />,
    );
    const trail = container.querySelector(".breadcrumb");

    expect(
      Array.from(trail?.querySelectorAll("a") ?? []).map((a) =>
        a.getAttribute("href"),
      ),
    ).toEqual([
      "/assembly-runs",
      "/repos/re-cinq/lore",
      "/repos/re-cinq/lore/implementation-loop",
    ]);
  });

  it("reads the backlog step by name between the repo and the line", () => {
    const { container } = render(
      <AssemblyRunView run={run({ blueprintName: "implementation-loop" })} />,
    );

    expect(container.querySelector(".breadcrumb")).toHaveTextContent(
      "Assembly Runs / re-cinq/lore / Backlog / implementation-loop",
    );
  });

  it("leaves the backlog out of a run no backlog started", () => {
    const { container } = render(<AssemblyRunView run={run()} />);

    expect(
      container.querySelector(
        'a[href="/repos/re-cinq/lore/implementation-loop"]',
      ),
    ).toBeNull();
  });
});
