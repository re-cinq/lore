// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TranscriptTurnsList } from "./TranscriptView";
import type { TranscriptEntry } from "@/lib/transcript-entries";

const AT = "2026-09-09T10:00:05.000Z";

function renderEntries(entries: TranscriptEntry[]) {
  return render(
    <TranscriptTurnsList show showRaw={false} turns={[]} entries={entries} />,
  );
}

describe("TranscriptTurnsList", () => {
  it("draws a tool call as one folded line with its result behind it, tinted when the result errored", () => {
    const { container } = renderEntries([
      {
        kind: "tool-call",
        at: AT,
        summary: "Bash npm test",
        result: { text: "1 failed", isError: true },
      },
    ]);
    const call = container.querySelector("details[data-tool-call]");

    expect(call?.querySelector("summary")).toHaveTextContent(
      "▸ Bash npm test ← 1 failed",
    );
    expect(call?.querySelector("pre")).toHaveTextContent("1 failed");
    expect(call?.className).toContain("toolError");
  });

  it("marks a call still waiting for its result as open", () => {
    const { container } = renderEntries([
      { kind: "tool-call", at: AT, summary: "Read src/a.ts", result: null },
    ]);

    expect(
      container.querySelector('[data-tool-call="open"]'),
    ).toHaveTextContent("▸ Read src/a.ts …");
  });

  it("folds thinking behind a summary and keeps the text", () => {
    const { container } = renderEntries([
      { kind: "thinking", at: AT, text: "consider the cache" },
    ]);
    const thinking = container.querySelector("details[data-thinking]");

    expect(thinking?.querySelector("summary")).toHaveTextContent("thinking…");
    expect(thinking?.querySelector("pre")).toHaveTextContent(
      "consider the cache",
    );
  });

  it("draws a task transition as a system line, folding its metadata when it has any", () => {
    const { container } = renderEntries([
      {
        kind: "task-event",
        at: AT,
        label: "task Running → Pr Created",
        metadata: null,
      },
      {
        kind: "task-event",
        at: AT,
        label: "task Pr Created → Merged",
        metadata: { pr: 12 },
      },
    ]);
    const lines = container.querySelectorAll("[data-task-event]");

    expect(lines[0]).toHaveTextContent("· task Running → Pr Created");
    expect(lines[1].querySelector("pre")).toHaveTextContent('"pr": 12');
  });

  it("heads a visit with its segment label and gives every row a clock", () => {
    const { container } = renderEntries([
      { kind: "segment", at: AT, label: "implement · iteration 2" },
      {
        kind: "turn",
        at: AT,
        entry: { kind: "assistant-text", text: "Done." },
      },
    ]);

    expect(container.querySelector('[data-entry="segment"]')).toHaveTextContent(
      "implement · iteration 2",
    );
    expect(container.querySelectorAll("time")).toHaveLength(2);
    expect(screen.getByText("Done.")).toBeInTheDocument();
  });
});
