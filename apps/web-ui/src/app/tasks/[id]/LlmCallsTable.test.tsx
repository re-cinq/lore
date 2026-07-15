// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LlmCallsTable from "./LlmCallsTable";
import type { TaskRuntimeLlmCall } from "@/lib/task-runtime";

const call = (over: Partial<TaskRuntimeLlmCall> = {}): TaskRuntimeLlmCall => ({
  model: "claude-opus-4-8",
  input_tokens: 1200,
  output_tokens: 340,
  duration_ms: 4500,
  status: "success",
  error: null,
  created_at: "2026-07-15T10:00:00Z",
  ...over,
});

describe("LlmCallsTable", () => {
  it("renders the empty note when there are no calls", () => {
    render(<LlmCallsTable llmCalls={[]} repo="re-cinq/lore" />);

    expect(
      screen.getByText("No LLM calls recorded for this task."),
    ).toBeInTheDocument();
  });

  it("renders a row with model, token counts and duration", () => {
    render(<LlmCallsTable llmCalls={[call()]} repo="re-cinq/lore" />);

    expect(screen.getByText("claude-opus-4-8")).toBeInTheDocument();
    expect(screen.getByText("1,200 / 340")).toBeInTheDocument();
    expect(screen.getByText("4.5s")).toBeInTheDocument();
  });

  it("marks a failed call and shows its error", () => {
    render(
      <LlmCallsTable
        llmCalls={[call({ status: "failed", error: "rate limited" })]}
        repo="re-cinq/lore"
      />,
    );

    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("rate limited")).toBeInTheDocument();
  });
});
