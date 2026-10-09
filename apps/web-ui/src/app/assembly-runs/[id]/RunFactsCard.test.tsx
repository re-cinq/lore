// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import RunFactsCard from "./RunFactsCard";
import type { AssemblyRun } from "@/lib/assembly-runs";

const run: AssemblyRun = {
  id: "run-1",
  blueprintName: "feature-planning",
  graph: null,
  taskId: null,
  repo: "re-cinq/otto",
  branch: "main",
  status: "failed",
  outcome: "failed",
  reason: null,
  createdAt: "2026-10-08T21:29:16.296Z",
  startedAt: "2026-10-08T21:29:16.296Z",
  durationSeconds: 66_587,
  prUrl: null,
  prNumber: null,
  issueUrl: null,
  issueNumber: null,
  createdBy: null,
  costUsd: null,
};

const bagOf = (taskId: string) => ({
  bag: { task_id: { kind: "value", ref: taskId, by: "lore" } },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("RunFactsCard", () => {
  it("shows the facts at once and the run's bag when its read arrives", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(bagOf("task-1"))),
    );

    render(<RunFactsCard run={run} refreshKey="a" />);

    expect(screen.getByText("Branch")).toBeInTheDocument();
    expect(screen.queryByText("Bag (1)")).toBeNull();

    await settle();

    expect(screen.getByText("Bag (1)")).toBeInTheDocument();
  });

  it("reads the bag again, and shows the new item, when the refresh key changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(bagOf("task-1")))
      .mockResolvedValueOnce(Response.json(bagOf("task-2")));

    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<RunFactsCard run={run} refreshKey="a" />);

    await settle();
    rerender(<RunFactsCard run={run} refreshKey="b" />);
    await settle();

    expect(screen.getByText("task-2")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels the read still in flight when the refresh key changes", async () => {
    const signals: AbortSignal[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        signals.push(init.signal as AbortSignal);

        return new Promise<Response>(() => {});
      }),
    );
    const { rerender } = render(<RunFactsCard run={run} refreshKey="a" />);

    rerender(<RunFactsCard run={run} refreshKey="b" />);

    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
  });

  it("drops an answer that arrived after the refresh key had already changed", async () => {
    let answerFirstRead = (_response: Response) => {};

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(
          new Promise<Response>((resolve) => {
            answerFirstRead = resolve;
          }),
        )
        .mockReturnValue(new Promise<Response>(() => {})),
    );
    const { rerender } = render(<RunFactsCard run={run} refreshKey="a" />);

    answerFirstRead(Response.json(bagOf("task-1")));
    rerender(<RunFactsCard run={run} refreshKey="b" />);
    await settle();

    expect(screen.queryByText(/^Bag \(/)).toBeNull();
  });

  it("shows the facts without a bag when the read fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 404 })),
    );

    render(<RunFactsCard run={run} refreshKey="a" />);
    await settle();

    expect(screen.getByText("Branch")).toBeInTheDocument();
    expect(screen.queryByText(/^Bag \(/)).toBeNull();
  });

  it("keeps the bag it has when a later read fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(bagOf("task-1")))
      .mockRejectedValueOnce(new Error("offline"));

    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<RunFactsCard run={run} refreshKey="a" />);

    await settle();
    rerender(<RunFactsCard run={run} refreshKey="b" />);
    await settle();

    expect(screen.getByText("Bag (1)")).toBeInTheDocument();
  });
});
