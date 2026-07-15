// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AssemblyLineRunsTable from "./AssemblyLineRunsTable";
import type { AssemblyLineRun } from "@/lib/assembly-line-runs";

// PRStatusBadgePanel fetches on mount; stub it so the badge case doesn't hit network.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({}) })) as unknown as typeof fetch,
  );
});

const run = (over: Partial<AssemblyLineRun> = {}): AssemblyLineRun => ({
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  definitionName: "implementation",
  taskId: "task-9",
  repo: "re-cinq/lore",
  branch: "lore/impl-x",
  status: "finished",
  outcome: "pr_created",
  reason: null,
  createdAt: "2026-07-14T10:00:00Z",
  startedAt: "2026-07-14T10:00:05Z",
  durationSeconds: 715,
  prUrl: "https://github.com/re-cinq/lore/pull/42",
  prNumber: 42,
  createdBy: "gedaiu",
  costUsd: 0.5,
  ...over,
});

describe("AssemblyLineRunsTable", () => {
  it("renders the empty-state line when there are no runs", () => {
    render(<AssemblyLineRunsTable runs={[]} />);

    expect(screen.getByText("No assembly line runs.")).toBeInTheDocument();
  });

  it("renders a finished run with a definition link, repo link, duration and PR", () => {
    render(<AssemblyLineRunsTable runs={[run()]} />);

    expect(
      screen.getByRole("link", { name: "implementation" }),
    ).toHaveAttribute(
      "href",
      "/assembly-lines/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    );
    expect(screen.getByRole("link", { name: "re-cinq/lore" })).toHaveAttribute(
      "href",
      "/repos/re-cinq/lore",
    );
    expect(screen.getByText("11m 55s")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#42" })).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/pull/42",
    );
    expect(screen.getByText("PR created")).toBeInTheDocument();
  });

  it("renders em dashes for creator, cost, PR and duration on a run with no task", () => {
    render(
      <AssemblyLineRunsTable
        runs={[
          run({
            taskId: null,
            prUrl: null,
            prNumber: null,
            createdBy: null,
            costUsd: null,
            durationSeconds: null,
          }),
        ]}
      />,
    );

    const row = screen.getByRole("row", { name: /implementation/ });

    // creator, cost, PR, duration all render as em dashes.
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("shows the failure reason under a failed status", () => {
    render(
      <AssemblyLineRunsTable
        runs={[
          run({ status: "failed", outcome: "error", reason: "lint failed" }),
        ]}
      />,
    );

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("lint failed")).toBeInTheDocument();
  });

  it("renders the PR link built from args.pr_number without a status badge (no task)", () => {
    render(
      <AssemblyLineRunsTable
        runs={[
          run({
            taskId: null,
            createdBy: null,
            costUsd: null,
            prUrl: "https://github.com/re-cinq/lore/pull/7",
            prNumber: 7,
          }),
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "#7" })).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/pull/7",
    );
    // No backing task → PRStatusBadgePanel is not rendered, so no fetch fires.
    expect(fetch).not.toHaveBeenCalled();
  });
});
