// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NodeTranscriptView, {
  recallScroll,
  rememberScroll,
  shouldFollowTail,
} from "./NodeTranscriptView";
import type { TranscriptRow } from "@/lib/transcript-rows";

const ts = "2026-07-20T10:00:00.000Z";

function message(seq: string, text: string): TranscriptRow {
  return { kind: "message", seq, ts, text };
}

function toolResult(
  over: Partial<Extract<TranscriptRow, { kind: "tool_result" }>> = {},
) {
  const row: TranscriptRow = {
    kind: "tool_result",
    seq: "9",
    ts,
    tool: "Bash",
    summary: "ok",
    detail: "full output",
    isError: false,
    truncated: false,
    ...over,
  };

  return row;
}

function renderView(rows: readonly TranscriptRow[], droppedCount = 0) {
  return render(
    <NodeTranscriptView
      nodeId="implement"
      rows={rows}
      droppedCount={droppedCount}
    />,
  );
}

describe("NodeTranscriptView", () => {
  it("renders one row per transcript event", () => {
    renderView([message("1", "alpha"), message("2", "beta")]);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders a tool call with its tool name and summary", () => {
    renderView([
      { kind: "tool_call", seq: "1", ts, tool: "Edit", summary: "spec.md" },
    ]);

    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("spec.md")).toBeInTheDocument();
  });

  it("renders a tool result inside a collapsed details element", () => {
    const { container } = renderView([toolResult()]);
    const details = container.querySelector("details");

    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(screen.getByText("full output")).toBeInTheDocument();
  });

  it("marks an error tool result with error text, not colour alone", () => {
    renderView([toolResult({ isError: true, summary: "ENOENT" })]);

    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("marks a truncated tool result with a truncated badge on the collapsed summary", () => {
    renderView([toolResult({ truncated: true })]);

    expect(screen.getByText("truncated")).toBeInTheDocument();
  });

  it("omits the truncated badge from a tool result that was not truncated", () => {
    renderView([toolResult()]);

    expect(screen.queryByText("truncated")).not.toBeInTheDocument();
  });

  it("renders an init row as a started line naming its iteration", () => {
    renderView([{ kind: "init", seq: "1", ts, iteration: 2 }]);

    expect(screen.getByText("Started iteration 2")).toBeInTheDocument();
  });

  it("renders a failed result row with error text", () => {
    renderView([
      { kind: "result", seq: "1", ts, text: "exit 1", isError: true },
    ]);

    expect(screen.getByText("exit 1")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders a successful result row as finished", () => {
    renderView([
      { kind: "result", seq: "1", ts, text: "done", isError: false },
    ]);

    expect(screen.getByText("Finished")).toBeInTheDocument();
  });

  it("states that 12 older events were dropped when droppedCount is 12", () => {
    renderView([message("1", "alpha")], 12);

    expect(
      screen.getByText("12 older events were dropped."),
    ).toBeInTheDocument();
  });

  it("omits the dropped-events notice when droppedCount is 0", () => {
    renderView([message("1", "alpha")]);

    expect(
      screen.queryByText(/older events were dropped/),
    ).not.toBeInTheDocument();
  });

  it("renders a waiting message for a node with an empty transcript", () => {
    renderView([]);

    expect(
      screen.getByText("No agent events for implement yet."),
    ).toBeInTheDocument();
  });

  it("renders an iteration divider between iteration 1 and iteration 2 rows", () => {
    renderView([
      { kind: "init", seq: "1", ts, iteration: 1 },
      { kind: "iteration", iteration: 2 },
      { kind: "init", seq: "2", ts, iteration: 2 },
    ]);

    expect(screen.getByText("Iteration 2")).toBeInTheDocument();
  });

  // querySelectorAll, not getAllByRole: the role query computes an accessible
  // role per element, which at this size dominates the measurement and times the
  // test out under coverage instrumentation. The claim here is structural — every
  // row reaches the DOM — so a structural query is the honest one.
  it("renders 3000 rows as 3000 row elements", () => {
    const rows = Array.from({ length: 3000 }, (_, i) =>
      message(String(i), `row ${i}`),
    );

    const { container } = renderView(rows);

    expect(container.querySelectorAll("ol > li")).toHaveLength(3000);
  });
});

describe("shouldFollowTail", () => {
  it("returns true from shouldFollowTail when the viewport sits at the bottom", () => {
    expect(shouldFollowTail(900, 1000, 100)).toBe(true);
  });

  it("returns false from shouldFollowTail when the reader has scrolled up 400 pixels", () => {
    expect(shouldFollowTail(500, 1000, 100)).toBe(false);
  });

  it("returns true from shouldFollowTail for a transcript shorter than its viewport", () => {
    expect(shouldFollowTail(0, 100, 400)).toBe(true);
  });
});

describe("per-node scroll retention", () => {
  it("recalls the implement offset after the selection moved to validate and back", () => {
    const afterImplement = rememberScroll({}, "implement", 320);
    const afterValidate = rememberScroll(afterImplement, "validate", 40);

    expect(recallScroll(afterValidate, "implement")).toBe(320);
    expect(recallScroll(afterValidate, "validate")).toBe(40);
  });

  it("recalls 0 for a node whose offset was never remembered", () => {
    expect(recallScroll({}, "implement")).toBe(0);
  });

  it("leaves the passed offsets unmutated when remembering a new offset", () => {
    const offsets = {};

    rememberScroll(offsets, "implement", 320);

    expect(offsets).toEqual({});
  });
});

describe("the input row", () => {
  const inputRow = (
    over: Partial<Extract<TranscriptRow, { kind: "input" }>> = {},
  ): TranscriptRow => ({
    kind: "input",
    iteration: 1,
    summary: "review the PR",
    description: "review the PR, carefully",
    prompt: "you are a reviewer",
    params: [],
    repo: "o/r",
    ref: "feat/x",
    truncated: false,
    ...over,
  });

  it("renders the input as the first row of the transcript", () => {
    render(
      <NodeTranscriptView
        nodeId="review"
        rows={[inputRow(), message("1", "starting")]}
        droppedCount={0}
      />,
    );

    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Input");
  });

  it("collapses the prompt behind a details disclosure with the description head as its summary", () => {
    render(
      <NodeTranscriptView
        nodeId="review"
        rows={[inputRow()]}
        droppedCount={0}
      />,
    );

    expect(screen.getByText("review the PR")).toBeInTheDocument();
    // Present but folded away: a 16KB prompt must not bury the transcript.
    expect(
      screen.getByText("you are a reviewer").closest("details"),
    ).not.toBeNull();
  });

  it("shows the truncated badge on a capped input", () => {
    render(
      <NodeTranscriptView
        nodeId="review"
        rows={[inputRow({ truncated: true })]}
        droppedCount={0}
      />,
    );

    expect(screen.getByText("truncated")).toBeInTheDocument();
  });

  it("lists a station node's params and the cloned repo and ref", () => {
    render(
      <NodeTranscriptView
        nodeId="detect"
        rows={[inputRow({ prompt: null, params: [["job_ref", "spec_drift"]] })]}
        droppedCount={0}
      />,
    );

    expect(screen.getByText("job_ref")).toBeInTheDocument();
    expect(screen.getByText("spec_drift")).toBeInTheDocument();
    expect(screen.getByText("o/r @ feat/x")).toBeInTheDocument();
  });
});
