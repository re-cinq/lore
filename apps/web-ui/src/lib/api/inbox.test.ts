// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { AssemblyRun } from "../assembly-run-rows";

vi.mock("server-only", () => ({}));

const { inboxItemsOf } = await import("./inbox");

const NOW = Date.parse("2026-10-20T12:00:00.000Z");

const run = (over: Partial<AssemblyRun>): AssemblyRun => ({
  id: "run-1",
  blueprintName: "implementation-loop",
  graph: null,
  taskId: null,
  repo: "re-cinq/lore",
  branch: null,
  status: "running",
  outcome: null,
  reason: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  startedAt: null,
  durationSeconds: null,
  prUrl: null,
  prNumber: null,
  issueUrl: null,
  issueNumber: null,
  createdBy: null,
  costUsd: null,
  pipeline: [],
  ...over,
});

const parked = (id: string, createdAt: string) =>
  run({ id, createdAt, pipeline: [{ node_id: "await-pr", state: "waiting" }] });

describe("inboxItemsOf", () => {
  it("puts failures first, then parked runs with the longest-waiting first", () => {
    const failed = [run({ id: "f1", status: "failed" })];
    const running = [
      parked("w-new", "2026-10-20T11:00:00.000Z"),
      parked("w-old", "2026-10-19T11:00:00.000Z"),
    ];

    expect(inboxItemsOf(failed, running, NOW).map((e) => e.runId)).toEqual([
      "f1",
      "w-old",
      "w-new",
    ]);
  });

  it("leaves out a running run with no station waiting and a failure older than a week", () => {
    const failed = [run({ id: "old", createdAt: "2026-10-01T00:00:00.000Z" })];
    const running = [
      run({ id: "busy", pipeline: [{ node_id: "tdd", state: "running" }] }),
    ];

    expect(inboxItemsOf(failed, running, NOW)).toEqual([]);
  });

  it("names the waiting station and links the pull request ahead of the issue", () => {
    const waiting = {
      ...parked("w", "2026-10-20T11:00:00.000Z"),
      prUrl: "https://pr",
      issueUrl: "https://issue",
    };
    const [entry] = inboxItemsOf([], [waiting], NOW);

    expect(entry?.title).toBe("implementation-loop is waiting at await-pr");
    expect(entry?.link).toEqual({
      label: "Open pull request",
      href: "https://pr",
    });
  });

  it("explains a failure with the run's own reason", () => {
    const [entry] = inboxItemsOf(
      [run({ reason: "CI never went green" })],
      [],
      NOW,
    );

    expect(entry?.body).toBe("CI never went green");
  });
});
