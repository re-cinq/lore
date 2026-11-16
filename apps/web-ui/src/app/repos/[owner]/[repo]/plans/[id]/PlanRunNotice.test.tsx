// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PlanRun } from "./PlanRunCard";
import PlanRunNotice from "./PlanRunNotice";

vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => <i data-testid={`icon-${name}`} />,
}));

const VISIT = {
  iteration: 1,
  agentCrName: null,
  commitSha: null,
  durationSeconds: null,
};

const RUN: PlanRun = {
  id: "r1",
  status: "running",
  outcome: null,
  reason: null,
  issueUrl: null,
  issueNumber: null,
  prUrl: null,
  prNumber: null,
  prTitle: null,
  prUnresolvedThreads: null,
  specPlanSummary: null,
  nodes: [
    { ...VISIT, nodeId: "analyze", outcome: "success" },
    { ...VISIT, nodeId: "author", outcome: null },
  ],
};

const SCOPE_FAILURE = {
  slot: "scope",
  title: "Scope",
  reason: "the model returned no proposal",
};

describe("PlanRunNotice", () => {
  it("warns that Scope could not be refined, with the agent's reason", () => {
    render(
      <PlanRunNotice
        run={RUN}
        state="writing"
        refineFailures={[SCOPE_FAILURE]}
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe(
      'The planning agent could not refine "Scope": the model returned no proposal. Ask again from that section, or regenerate the plan.',
    );
  });

  it("warns that the plan could not be drafted when the first pass failed", () => {
    render(
      <PlanRunNotice
        run={{
          ...RUN,
          nodes: [
            {
              ...VISIT,
              nodeId: "analyze",
              outcome: "failed",
              failureDetail: "model quota exhausted",
            },
            { ...VISIT, nodeId: "author", outcome: null },
          ],
        }}
        state="writing"
        refineFailures={[]}
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "The planning agent could not draft the plan: model quota exhausted. Regenerate the plan to ask again.",
    );
  });

  it("warns that the prototype could not be drawn when the sketch visit failed", () => {
    render(
      <PlanRunNotice
        run={{
          ...RUN,
          nodes: [
            { ...VISIT, nodeId: "analyze", outcome: "success" },
            {
              ...VISIT,
              nodeId: "sketch",
              outcome: "failed",
              failureDetail: "model quota exhausted",
            },
            { ...VISIT, nodeId: "author", outcome: null },
          ],
        }}
        state="writing"
        refineFailures={[]}
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "The agent could not draw the prototype: model quota exhausted. Generate it again from the Prototype section.",
    );
  });

  it("says nothing of a failed sketch once a later analyze pass succeeded", () => {
    const { container } = render(
      <PlanRunNotice
        run={{
          ...RUN,
          nodes: [
            { ...VISIT, nodeId: "sketch", outcome: "failed" },
            { ...VISIT, nodeId: "analyze", outcome: "success" },
            { ...VISIT, nodeId: "author", outcome: null },
          ],
        }}
        state="writing"
        refineFailures={[]}
      />,
    );

    expect(container.textContent).toBe("");
  });

  it("says nothing while the agent is drafting", () => {
    const { container } = render(
      <PlanRunNotice
        run={{
          ...RUN,
          nodes: [{ ...VISIT, nodeId: "analyze", outcome: null }],
        }}
        state="drafting"
        refineFailures={[]}
      />,
    );

    expect(container.textContent).toBe("");
  });

  it("warns with the reason when the run failed", () => {
    render(
      <PlanRunNotice
        run={{ ...RUN, status: "failed", reason: "no runner claimed the run" }}
        state="writing"
        refineFailures={[]}
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "The run failed: no runner claimed the run",
    );
  });

  it("warns that the spec work did not deliver", () => {
    render(
      <PlanRunNotice
        run={{ ...RUN, status: "failed" }}
        state="spec-work-failed"
        refineFailures={[]}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "The spec work did not deliver.",
    );
  });
  it("keeps Scope's failed refine quiet while the agent refines another section", () => {
    const { container } = render(
      <PlanRunNotice
        run={{
          ...RUN,
          nodes: [{ ...VISIT, nodeId: "analyze", iteration: 2, outcome: null }],
        }}
        state="refining"
        refineFailures={[
          { slot: "scope", title: "Scope", reason: "model quota exhausted" },
        ]}
      />,
    );

    expect(container.textContent).toBe("");
  });
});
