// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RunNodeDetail from "./RunNodeDetail";
import { implementationDefinition } from "@/lib/builtin-definitions";
import type { AssemblyLineRunNode } from "@/lib/assembly-line-runs";
import type { NodeRunState } from "@/lib/run-event-reducer";

const row = (over: Partial<AssemblyLineRunNode> = {}): AssemblyLineRunNode => ({
  nodeId: "implement",
  iteration: 1,
  outcome: "success",
  agentCrName: "cr-1",
  commitSha: "deadbeefcafe",
  durationSeconds: 96,
  ...over,
});

const state = (over: Partial<NodeRunState> = {}): NodeRunState => ({
  status: "succeeded",
  outcome: null,
  iteration: 1,
  transcript: [],
  droppedCount: 0,
  ...over,
});

describe("RunNodeDetail", () => {
  it("renders the why line, status pill and shortened commit link", () => {
    render(
      <RunNodeDetail
        nodeId="implement"
        state={state()}
        row={row()}
        definition={implementationDefinition}
        reason={null}
        repo="re-cinq/lore"
      />,
    );

    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    expect(
      screen.getByText("Ran the agent node and emitted success in 1m 36s."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "deadbee" })).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/commit/deadbeefcafe",
    );
  });

  it("labels an idle terminal node Terminal with a terminal why", () => {
    render(
      <RunNodeDetail
        nodeId="done"
        state={undefined}
        row={undefined}
        definition={implementationDefinition}
        reason={null}
        repo="re-cinq/lore"
      />,
    );

    expect(screen.getByText("Terminal")).toBeInTheDocument();
    expect(
      screen.getByText("Terminal marker — the run ends here."),
    ).toBeInTheDocument();
  });

  it("lists the errored steps of a failed node with their tool and detail", () => {
    const erroredEvent = (
      over: Partial<import("@/lib/run-stream-types").RunStreamEvent>,
    ): import("@/lib/run-stream-types").RunStreamEvent => ({
      id: "1",
      taskId: "t",
      agentCrName: "cr-1",
      assemblyLineId: "al",
      nodeId: "implement",
      iteration: 1,
      eventType: "tool_result",
      toolName: null,
      toolUseId: null,
      isError: true,
      filePaths: [],
      summary: null,
      payload: {},
      createdAt: "2026-07-14T10:00:00Z",
      ...over,
    });

    render(
      <RunNodeDetail
        nodeId="implement"
        state={state({
          status: "failed",
          transcript: [
            erroredEvent({ toolName: "eslint", summary: "2 problems" }),
            erroredEvent({
              id: "2",
              toolName: "Bash",
              summary: "tsc exited 2",
            }),
          ],
        })}
        row={row({ outcome: "implement-failed" })}
        definition={implementationDefinition}
        reason={null}
        repo="re-cinq/lore"
      />,
    );

    expect(screen.getByText("Errored steps (2)")).toBeInTheDocument();
    expect(screen.getByText("eslint")).toBeInTheDocument();
    expect(screen.getByText("2 problems")).toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("tsc exited 2")).toBeInTheDocument();
  });
});
