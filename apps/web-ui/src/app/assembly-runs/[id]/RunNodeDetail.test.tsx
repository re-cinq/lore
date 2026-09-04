// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RunNodeDetail from "./RunNodeDetail";
import { implementationDefinition } from "@/lib/definition-fixtures";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import type { NodeRunState } from "@/lib/run-event-reducer";
import type { StepView } from "@/lib/step-presenter";

const row = (over: Partial<AssemblyRunNode> = {}): AssemblyRunNode => ({
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
  iteration: 1,
  transcript: [],
  droppedCount: 0,
  ...over,
});

const attempt = (over: Partial<StepView> = {}): StepView => ({
  nodeId: "validate",
  iteration: 1,
  tone: "ok",
  label: "Succeeded",
  outcome: "success",
  agentCrName: "cr-1",
  commitSha: null,
  durationSeconds: 45,
  transition: null,
  reason: null,
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
        attempts={[]}
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
        attempts={[]}
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
      stationRunId: null,
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
        attempts={[]}
      />,
    );

    expect(screen.getByText("Errored steps (2)")).toBeInTheDocument();
    expect(screen.getByText("eslint")).toBeInTheDocument();
    expect(screen.getByText("2 problems")).toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("tsc exited 2")).toBeInTheDocument();
  });

  it("renders the attempts history with transitions and commit links when the node looped", () => {
    render(
      <RunNodeDetail
        nodeId="validate"
        state={state()}
        row={row({ nodeId: "validate", iteration: 2 })}
        definition={implementationDefinition}
        reason={null}
        repo="re-cinq/lore"
        attempts={[
          attempt({
            tone: "err",
            label: "Failed",
            outcome: "failed",
            agentCrName: "cr-a1",
            commitSha: "aaa1111ffff",
            transition: "failed ↩ implement",
            reason: "lint failed",
          }),
          attempt({
            iteration: 2,
            agentCrName: "cr-a2",
            commitSha: "bbb2222ffff",
            transition: "success → done",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Attempts (2)")).toBeInTheDocument();
    expect(screen.getByText("failed ↩ implement")).toBeInTheDocument();
    expect(screen.getByText("success → done")).toBeInTheDocument();
    expect(screen.getByText("cr-a1")).toBeInTheDocument();
    expect(screen.getByText("cr-a2")).toBeInTheDocument();
    expect(screen.getByText("lint failed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "aaa1111" })).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/commit/aaa1111ffff",
    );
  });

  it("omits the attempts history for a single attempt", () => {
    render(
      <RunNodeDetail
        nodeId="implement"
        state={state()}
        row={row()}
        definition={implementationDefinition}
        reason={null}
        repo="re-cinq/lore"
        attempts={[attempt({ nodeId: "implement" })]}
      />,
    );

    expect(screen.queryByText(/^Attempts \(/)).not.toBeInTheDocument();
  });

  it("shows singular event count, dropped events and touched file count", () => {
    const erroredEvent = (
      over: Partial<import("@/lib/run-stream-types").RunStreamEvent>,
    ): import("@/lib/run-stream-types").RunStreamEvent => ({
      id: "1",
      taskId: "t",
      agentCrName: "cr-1",
      assemblyLineId: "al",
      stationRunId: null,
      nodeId: "implement",
      iteration: 1,
      eventType: "tool_result",
      toolName: "eslint",
      toolUseId: null,
      isError: false,
      filePaths: ["src/a.ts"],
      summary: null,
      payload: {},
      createdAt: "2026-07-14T10:00:00Z",
      ...over,
    });

    render(
      <RunNodeDetail
        nodeId="implement"
        state={state({ transcript: [erroredEvent({})], droppedCount: 3 })}
        row={row()}
        definition={implementationDefinition}
        reason={null}
        repo="re-cinq/lore"
        attempts={[]}
      />,
    );

    expect(screen.getByText("1 event (+3 dropped)")).toBeInTheDocument();
    expect(screen.getByText("Files touched").nextSibling).toHaveTextContent(
      "1",
    );
  });
});
