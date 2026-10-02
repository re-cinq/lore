// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { AssemblyRun } from "@/lib/assembly-run-rows";
import type { components } from "@/lib/api/schema";
import { FakeWebSocket } from "@/lib/live-socket/fake-web-socket";
import { LiveSocketProvider } from "@/lib/live-socket/LiveSocketProvider";
import AssemblyRunsLive from "./AssemblyRunsLive";
import { loadRunsPageAction } from "./runs-live-actions";

vi.mock("./runs-live-actions", () => ({
  openRunsChannelAction: async () => ({ token: "t-1" }),
  loadRunsPageAction: vi.fn(),
}));

type WireRun = components["schemas"]["FloorRunPage"]["runs"][number];

const run = (over: Partial<AssemblyRun>): AssemblyRun => ({
  id: "run-1",
  blueprintName: "code-review",
  graph: null,
  taskId: null,
  repo: "re-cinq/lore",
  branch: null,
  status: "running",
  outcome: null,
  reason: null,
  createdAt: "2026-10-02T09:00:00Z",
  startedAt: null,
  durationSeconds: null,
  prUrl: null,
  prNumber: null,
  issueUrl: null,
  issueNumber: null,
  createdBy: null,
  costUsd: null,
  ...over,
});

const finishedWireRun: WireRun = {
  id: "run-1",
  blueprint_name: "code-review",
  definition_name: "code-review",
  task_id: null,
  repo: "re-cinq/lore",
  branch: null,
  subject_key: null,
  engine: "floor",
  status: "finished",
  outcome: "success",
  reason: null,
  created_at: "2026-10-02T09:00:00Z",
  started_at: "2026-10-02T09:00:01Z",
  finished_at: "2026-10-02T09:05:00Z",
  args_pr_number: null,
  spec_plan_summary: null,
  pr_url: null,
  task_pr_number: null,
  issue_url: null,
  issue_number: null,
  created_by: null,
  cost_usd: null,
  pipeline: [{ node_id: "review", state: "success" }],
};

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({}) })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AssemblyRunsLive", () => {
  it("turns run-1 from Running to review success on a run_row frame, without a reload", async () => {
    render(
      <LiveSocketProvider url="ws://test/api/ws" socket={FakeWebSocket}>
        <AssemblyRunsLive
          initial={{
            runs: [
              run({
                pipeline: [{ node_id: "review", state: "running" }],
              }),
            ],
            nextCursor: null,
          }}
        />
      </LiveSocketProvider>,
    );

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    await act(async () => {
      await FakeWebSocket.latest.acceptAndOpenAll();
    });
    const { channel } = FakeWebSocket.latest.opens[0];

    await act(async () => {
      FakeWebSocket.latest.receive({
        type: "runs",
        channel,
        frame: { type: "run_row", run: finishedWireRun },
      });
    });

    const watch = FakeWebSocket.latest.sent.find((m) => m.type === "watch");

    await waitFor(() =>
      expect(screen.getByTestId("mini-node-review")).toHaveAttribute(
        "title",
        "review: success",
      ),
    );
    expect({
      watched: watch?.type === "watch" ? watch.runs : undefined,
      dot: screen.getByTestId("mini-node-review").getAttribute("title"),
      reloads: vi.mocked(loadRunsPageAction).mock.calls.length,
    }).toEqual({ watched: ["run-1"], dot: "review: success", reloads: 0 });
  });
});
