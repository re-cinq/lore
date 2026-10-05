// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import RepoTasksView from "./RepoTasksView";
import type { AssemblyRun } from "@/lib/assembly-runs";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({}) })) as unknown as typeof fetch,
  );
});

const run = (over: Partial<AssemblyRun> = {}): AssemblyRun => ({
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
  issueUrl: null,
  issueNumber: null,
  createdBy: "bogdan",
  costUsd: 0.25,
  ...over,
});

describe("RepoTasksView", () => {
  it("renders the Assembly Runs heading and intro copy, and offers no way to create a task", () => {
    renderView();

    expect(
      screen.getByRole("heading", { level: 2, name: "Assembly Runs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Assembly lines targeting this repo/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /New Task/ })).toBeNull();
  });

  it("renders the empty-state row when there are no runs", () => {
    renderView();
    expect(screen.getByText("No assembly line runs.")).toBeInTheDocument();
  });

  it("renders a repo run with its summed task cost", () => {
    renderView({ earlierRuns: [run({ costUsd: 1.5 })] });

    expect(screen.getByText("$1.50")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "implementation" }),
    ).toHaveAttribute(
      "href",
      "/assembly-runs/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    );
  });
});

vi.mock("@/app/assembly-runs/runs-live-actions", () => ({
  openRunsChannelAction: async () => ({ token: "t-1" }),
  loadRunsPageAction: vi.fn(),
}));

const floorRun = run({
  id: "run-1",
  blueprintName: "code-review",
  status: "running",
  outcome: null,
  pipeline: [{ node_id: "review", state: "running" }],
});
const oldRun = run({
  id: "dbccc0a0-b910-4e1c-bde8-0f90783d98ce",
  blueprintName: "implementation-loop",
});

function renderView(over: Partial<ComponentProps<typeof RepoTasksView>> = {}) {
  return render(
    <LiveSocketProvider url="ws://test/api/ws" socket={FakeWebSocket}>
      <RepoTasksView
        repo="re-cinq/lore"
        initial={{ runs: [], nextCursor: null }}
        earlierRuns={[]}
        {...over}
      />
    </LiveSocketProvider>,
  );
}

function tabSections() {
  return {
    stagesColumns: screen.queryAllByRole("columnheader", { name: "Stages" })
      .length,
    hasEarlierHeading: !!screen.queryByRole("heading", {
      name: "Earlier runs",
    }),
  };
}

describe("RepoTasksView live tab", () => {
  it("shows run-1 with a Stages column and Earlier runs only while old runs exist", () => {
    const withOldRuns = renderView({
      initial: { runs: [floorRun], nextCursor: null },
      earlierRuns: [oldRun],
    });
    const { stagesColumns, hasEarlierHeading } = tabSections();

    withOldRuns.unmount();
    renderView({ initial: { runs: [floorRun], nextCursor: null } });

    expect({
      stagesColumns,
      earlierHeading: hasEarlierHeading,
      earlierWithoutOldRuns: tabSections().hasEarlierHeading,
    }).toEqual({
      stagesColumns: 1,
      earlierHeading: true,
      earlierWithoutOldRuns: false,
    });
  });
});
import type { ComponentProps } from "react";
import { FakeWebSocket } from "@/lib/live-socket/fake-web-socket";
import { LiveSocketProvider } from "@/lib/live-socket/LiveSocketProvider";
