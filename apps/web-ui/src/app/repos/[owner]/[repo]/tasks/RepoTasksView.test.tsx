// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import RepoTasksView from "./RepoTasksView";
import type { AssemblyLineRun } from "@/lib/assembly-line-runs";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({}) })) as unknown as typeof fetch,
  );
});

const run = (over: Partial<AssemblyLineRun> = {}): AssemblyLineRun => ({
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  blueprintName: "implementation",
  graph: null,
  taskId: "task-9",
  repo: "re-cinq/lore",
  branch: "lore/impl-x",
  status: "finished",
  outcome: "pr_created",
  reason: null,
  createdAt: "2026-07-14T10:00:00Z",
  startedAt: "2026-07-14T10:00:05Z",
  durationSeconds: 715,
  prUrl: null,
  prNumber: null,
  createdBy: "bogdan",
  costUsd: 0.25,
  ...over,
});

describe("RepoTasksView", () => {
  it("renders the Assembly Runs heading, intro copy and New Task link", () => {
    render(<RepoTasksView owner="re-cinq" repo="lore" runs={[]} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Assembly Runs" }),
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
    expect(screen.getByText("No assembly line runs.")).toBeInTheDocument();
  });

  it("renders a repo run with its summed task cost", () => {
    render(
      <RepoTasksView
        owner="re-cinq"
        repo="lore"
        runs={[run({ costUsd: 1.5 })]}
      />,
    );

    expect(screen.getByText("$1.50")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "implementation" }),
    ).toHaveAttribute(
      "href",
      "/assembly-runs/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    );
  });
});
