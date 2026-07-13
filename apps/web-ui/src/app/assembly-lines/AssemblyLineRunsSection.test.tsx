// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AssemblyLineRunsSection from "./AssemblyLineRunsSection";
import type { AssemblyLineRun } from "@/lib/assembly-line-runs";

const run = (over: Partial<AssemblyLineRun> = {}): AssemblyLineRun => ({
  id: "11111111-2222-4333-8444-555555555555",
  definitionName: "implementation",
  taskId: "task-9",
  repo: "re-cinq/lore",
  branch: "lore/implementation/widget-abcd1234",
  status: "finished",
  outcome: "completed",
  reason: null,
  createdAt: "2026-07-03T10:00:00.000Z",
  nodeCount: 5,
  durationSeconds: 715,
  ...over,
});

describe("AssemblyLineRunsSection", () => {
  it("renders nothing when there are no runs (pre-migration databases)", () => {
    const { container } = render(<AssemblyLineRunsSection runs={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one row per run with definition, repo, node count, and outcome", () => {
    render(
      <AssemblyLineRunsSection
        runs={[
          run(),
          run({
            id: "22222222-2222-4333-8444-555555555555",
            status: "running",
            outcome: null,
            nodeCount: 2,
            durationSeconds: null,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Recent assembly line runs")).toBeTruthy();
    expect(screen.getAllByText("implementation")).toHaveLength(2);
    expect(screen.getByText("completed")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
    expect(screen.getByText("5 nodes")).toBeTruthy();
    expect(screen.getByText("2 nodes")).toBeTruthy();
  });

  it("shows the failure reason when a run failed", () => {
    render(
      <AssemblyLineRunsSection
        runs={[
          run({
            status: "failed",
            outcome: "error",
            reason: "iteration_max exceeded",
          }),
        ]}
      />,
    );
    expect(screen.getByText("iteration_max exceeded")).toBeTruthy();
  });

  it("formats sub-minute durations in seconds", () => {
    render(<AssemblyLineRunsSection runs={[run({ durationSeconds: 42 })]} />);
    expect(screen.getByText("42s")).toBeTruthy();
  });

  it("renders a queued run (no styled status class, em-dash duration)", () => {
    render(
      <AssemblyLineRunsSection
        runs={[
          run({
            status: "queued",
            outcome: null,
            durationSeconds: null,
            nodeCount: 0,
          }),
        ]}
      />,
    );
    expect(screen.getByText("queued")).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});
