// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { AssemblyRun } from "@/lib/assembly-run-rows";
import type { components } from "@/lib/api/schema";
import type { RunListFrame } from "@/lib/live-socket/protocol";
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

const oneRunPage = { runs: [run({})], nextCursor: null };
const newerRunPage = {
  runs: [run({ id: "run-2", blueprintName: "spec-upkeep" }), run({})],
  nextCursor: null,
};

beforeEach(() => {
  FakeWebSocket.reset();
  vi.mocked(loadRunsPageAction).mockReset();
  vi.mocked(loadRunsPageAction).mockResolvedValue(oneRunPage);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({}) })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type LiveProps = Partial<ComponentProps<typeof AssemblyRunsLive>>;

function renderLive(props: LiveProps = {}) {
  render(
    <LiveSocketProvider url="ws://test/api/ws" socket={FakeWebSocket}>
      <AssemblyRunsLive
        initial={{ runs: [run({})], nextCursor: null }}
        {...props}
      />
    </LiveSocketProvider>,
  );
}

async function openChannel(): Promise<string> {
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  await act(async () => {
    await FakeWebSocket.latest.acceptAndOpenAll();
  });

  return FakeWebSocket.latest.opens[0].channel;
}

async function sendFrame(frame: RunListFrame): Promise<void> {
  const channel = FakeWebSocket.latest.opens[0].channel;

  await act(async () => {
    FakeWebSocket.latest.receive({ type: "runs", channel, frame });
  });
}

const reads = () => vi.mocked(loadRunsPageAction).mock.calls.length;
const askedAt = (index: number) =>
  vi.mocked(loadRunsPageAction).mock.calls[index]?.[0];

function lastWatched(): string[] | undefined {
  const watch = FakeWebSocket.latest.sent.filter((m) => m.type === "watch");
  const last = watch.at(-1);

  return last?.type === "watch" ? last.runs : undefined;
}

const newRunLink = () => screen.findByRole("link", { name: "spec-upkeep" });

describe("AssemblyRunsLive", () => {
  it("turns run-1 from Running to review success on a run_row frame, without a reload", async () => {
    renderLive({
      initial: {
        runs: [run({ pipeline: [{ node_id: "review", state: "running" }] })],
        nextCursor: null,
      },
    });
    await openChannel();
    const readsBeforeFrame = reads();

    await sendFrame({ type: "run_row", run: finishedWireRun });

    await waitFor(() =>
      expect(screen.getByTestId("mini-node-review")).toHaveAttribute(
        "title",
        "review: success",
      ),
    );
    expect({
      watched: lastWatched(),
      dot: screen.getByTestId("mini-node-review").getAttribute("title"),
      reloadsCausedByFrame: reads() - readsBeforeFrame,
    }).toEqual({
      watched: ["run-1"],
      dot: "review: success",
      reloadsCausedByFrame: 0,
    });
  });

  it("reads the page again once the channel is live, so run-2 started before the socket opened shows and is watched", async () => {
    vi.mocked(loadRunsPageAction).mockResolvedValue(newerRunPage);
    renderLive();
    await openChannel();

    await newRunLink();
    await waitFor(() => expect(lastWatched()).toEqual(["run-2", "run-1"]));
    expect({ asked: askedAt(0), watched: lastWatched() }).toEqual({
      asked: { status: undefined, cursor: undefined },
      watched: ["run-2", "run-1"],
    });
  });

  it("reads the first page with status failed and shows run-2 on run_started", async () => {
    vi.mocked(loadRunsPageAction).mockResolvedValue(newerRunPage);
    renderLive({ activeStatus: "failed" });
    await openChannel();
    const readsBeforeFrame = reads();

    await sendFrame({ type: "run_started", run_id: "run-2" });

    await newRunLink();
    expect(askedAt(readsBeforeFrame)).toEqual({
      status: "failed",
      cursor: undefined,
    });
  });

  it("reads nothing again on run_started when on the older page-2", async () => {
    renderLive({ cursor: "page-2" });
    await openChannel();
    const readsBeforeFrame = reads();

    await sendFrame({ type: "run_started", run_id: "run-2" });

    expect({ readsCausedByFrame: reads() - readsBeforeFrame }).toEqual({
      readsCausedByFrame: 0,
    });
  });

  it("reads page-2 again on resync when on the older page-2", async () => {
    renderLive({ cursor: "page-2" });
    await openChannel();
    const readsBeforeFrame = reads();

    await sendFrame({ type: "resync" });

    expect(askedAt(readsBeforeFrame)).toEqual({
      status: undefined,
      cursor: "page-2",
    });
  });

  it("shows the connection chip as Live once the channel is opened", async () => {
    renderLive();
    await openChannel();

    await waitFor(() =>
      expect(screen.getByTestId("runs-connection")).toHaveTextContent("Live"),
    );
  });

  it("reads the page exactly once more after the socket drops and the channel reopens", async () => {
    renderLive();
    await openChannel();
    const readsBeforeDrop = reads();

    await act(async () => {
      FakeWebSocket.latest.drop();
    });
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2), {
      timeout: 4_000,
    });
    await act(async () => {
      await FakeWebSocket.latest.acceptAndOpenAll();
    });

    await waitFor(() => expect(reads()).toBeGreaterThan(readsBeforeDrop));
    expect({ readsCausedByReconnect: reads() - readsBeforeDrop }).toEqual({
      readsCausedByReconnect: 1,
    });
  }, 10_000);
});
