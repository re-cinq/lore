// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PlanRunCard, { type PlanRun } from "./PlanRunCard";

vi.mock("@/app/assembly-runs/[id]/RunVisualizationPanel", () => ({
  default: ({ runId }: { runId: string }) => <p>graph of {runId}</p>,
}));

const RUN: PlanRun = {
  id: "run-1",
  status: "running",
  reason: null,
  repo: "re-cinq/lore",
  prUrl: null,
  prNumber: null,
  definition: null,
  nodes: [
    {
      nodeId: "analyze",
      iteration: 1,
      outcome: "success",
      agentCrName: null,
      commitSha: null,
      durationSeconds: 60,
    },
    {
      nodeId: "author",
      iteration: 1,
      outcome: null,
      agentCrName: null,
      commitSha: null,
      durationSeconds: null,
    },
  ],
};

describe("PlanRunCard", () => {
  it("says the plan waits for its people and links run-1's page", () => {
    render(<PlanRunCard run={RUN} />);

    expect({
      phase: screen.getByText(/Waiting for you/).textContent,
      link: screen
        .getByRole("link", { name: "Open the run →" })
        .getAttribute("href"),
    }).toEqual({
      phase: "Waiting for you: refine sections or approve the plan.",
      link: "/assembly-runs/run-1",
    });
  });

  it("draws run-1's live graph", () => {
    render(<PlanRunCard run={RUN} />);

    expect(screen.getByText("graph of run-1")).toBeInTheDocument();
  });

  it("links the spec PR once the run opened one", () => {
    render(
      <PlanRunCard
        run={{
          ...RUN,
          prUrl: "https://github.com/re-cinq/lore/pull/7",
          prNumber: 7,
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Spec PR #7" })).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/pull/7",
    );
  });

  it("says no run has started for a plan without one", () => {
    render(<PlanRunCard run={null} />);

    expect(screen.getByText("No planning run yet.")).toBeInTheDocument();
  });
});
