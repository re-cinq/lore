// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AgentAttemptCard from "./AgentAttemptCard";
import type { AssemblyRunNode } from "@/lib/assembly-runs";

vi.mock("./FullTranscriptPanel", () => ({
  default: ({ nodeStatus }: { nodeStatus?: string }) => (
    <p data-testid="transcript">{nodeStatus ?? "no status"}</p>
  ),
}));
vi.mock("./NodeLogPanel", () => ({ default: () => null }));

function renderCard(outcome: string | null) {
  return render(
    <AgentAttemptCard
      runId="run-1"
      nodeId="implement"
      attempt={attempt(outcome)}
      kind="transcript"
    />,
  );
}

function attempt(outcome: string | null): AssemblyRunNode {
  return {
    nodeId: "implement",
    iteration: 1,
    outcome,
    agentCrName: "pod-1",
    commitSha: null,
    durationSeconds: null,
  };
}

describe("AgentAttemptCard", () => {
  it("hands the transcript the status running for an open attempt", () => {
    renderCard(null);

    expect(screen.getByTestId("transcript")).toHaveTextContent("running");
  });

  it("hands the transcript no status for a finished attempt", () => {
    renderCard("succeeded");

    expect(screen.getByTestId("transcript")).toHaveTextContent("no status");
  });
});
