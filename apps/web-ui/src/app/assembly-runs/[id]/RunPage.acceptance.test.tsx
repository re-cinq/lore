// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import RunLiveShell from "./RunLiveShell";
import type { AssemblyRun } from "@/lib/assembly-runs";
import { LiveSocketProvider } from "@/lib/live-socket/LiveSocketProvider";
import { FakeWebSocket } from "@/lib/live-socket/fake-web-socket";

describe("RunPage Blocked Reason", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("queries the blocked-reason API and displays it for a finished run with a PR", async () => {
    global.fetch = vi.fn(async (url: string | Request | URL) => {
      if (
        url
          .toString()
          .includes("/api/repos/re-cinq/lore/pulls/42/blocked-reason")
      ) {
        return {
          ok: true,
          json: async () => ({
            repo: "re-cinq/lore",
            prNumber: 42,
            reason: "ci_failing",
            label: "Waiting for CI",
            detail: null,
            since: "2026-09-09T10:00:00.000Z",
            updatedAt: "2026-09-09T10:00:00.000Z",
          }),
        };
      }

      return { ok: true, json: async () => [] };
    }) as unknown as typeof fetch;

    const run: AssemblyRun = {
      id: "run-42",
      blueprintName: "implementation",
      graph: null,
      taskId: "task-1",
      repo: "re-cinq/lore",
      branch: "feat/x",
      status: "finished",
      outcome: "success",
      reason: null,
      createdAt: "2026-09-09T10:00:00.000Z",
      startedAt: "2026-09-09T10:00:05.000Z",
      durationSeconds: 10,
      prUrl: "https://github.com/re-cinq/lore/pulls/42",
      prNumber: 42,
      issueUrl: null,
      issueNumber: null,
      createdBy: null,
      costUsd: null,
      engine: "lore",
    };

    render(
      <LiveSocketProvider url="ws://test/api/ws" socket={FakeWebSocket}>
        <RunLiveShell
          run={run}
          nodes={[]}
          definition={null}
          taskEvents={[]}
          llmCalls={[]}
        />
      </LiveSocketProvider>,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          "/api/repos/re-cinq/lore/pulls/42/blocked-reason",
        ),
        expect.anything(),
      );
    });

    expect(screen.getByText("Waiting for CI")).toBeInTheDocument();
  });
});
