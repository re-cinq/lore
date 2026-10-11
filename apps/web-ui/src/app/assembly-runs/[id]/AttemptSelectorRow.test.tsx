// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { StepView } from "@/lib/step-presenter";
import { AttemptSelectorRow } from "./AttemptSelectorRow";

const attempt = (iteration: number, label: string): StepView => ({
  nodeId: "implement",
  iteration,
  tone: "ok",
  label,
  outcome: "success",
  agentCrName: null,
  commitSha: null,
  durationSeconds: null,
  transition: null,
  reason: null,
});

function renderRow(onKindChange = vi.fn(), onAttemptChange = vi.fn()) {
  render(
    <AttemptSelectorRow
      kind="transcript"
      onKindChange={onKindChange}
      attempts={[attempt(1, "Failed"), attempt(2, "Succeeded")]}
      selectedIteration={2}
      onAttemptChange={onAttemptChange}
    />,
  );

  return { onKindChange, onAttemptChange };
}

describe("AttemptSelectorRow", () => {
  it("styles both selects as settings-page form fields", () => {
    renderRow();

    expect(screen.getByLabelText("Show").closest(".task-form")).not.toBeNull();
    expect(
      screen.getByLabelText("Attempt").closest(".task-form"),
    ).not.toBeNull();
  });

  it("offers attempt 1 · Failed and attempt 2 · Succeeded with attempt 2 selected", () => {
    renderRow();

    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual([
      "Transcript",
      "Pod logs",
      "attempt 1 · Failed",
      "attempt 2 · Succeeded",
    ]);
    expect(screen.getByLabelText("Attempt")).toHaveValue("2");
  });

  it("reports attempt 1 when it is chosen", () => {
    const { onAttemptChange } = renderRow();

    fireEvent.change(screen.getByLabelText("Attempt"), {
      target: { value: "1" },
    });

    expect(onAttemptChange).toHaveBeenCalledWith(1);
  });

  it("reports pods when Pod logs is chosen", () => {
    const { onKindChange } = renderRow();

    fireEvent.change(screen.getByLabelText("Show"), {
      target: { value: "pods" },
    });

    expect(onKindChange).toHaveBeenCalledWith("pods");
  });
});
