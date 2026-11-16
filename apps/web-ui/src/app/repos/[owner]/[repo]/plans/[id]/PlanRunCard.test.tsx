// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PlanRunCard, { type PlanRun } from "./PlanRunCard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const RUN: PlanRun = {
  id: "run-1",
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
  const asked = {
    ...RUN,
    specPlanSummary:
      "CHANGES REQUESTED. Should spec-writing proceed on the SQL-cron scope?",
  };

  it("explains that spec writing paused on a question, quotes it without its verdict word, and says to Reopen, answer, then Approve", () => {
    render(
      <PlanRunCard run={asked} state="question" reopen={async () => ({})} />,
    );
    const panel = screen.getByRole("region", {
      name: "The spec writer has a question for you",
    });

    expect({
      why: within(panel).getByText(/You approved this plan/).textContent,
      quote: within(panel).getByRole("blockquote").textContent,
      steps: within(panel)
        .getAllByRole("listitem")
        .map((step) => step.textContent),
      reopen:
        within(panel).getByRole("button", { name: "Reopen plan" }) !== null,
    }).toEqual({
      why: "You approved this plan, so an agent started turning it into spec files. Before writing them it checked the plan and found a decision it cannot make on its own, so it stopped and waits for your answer.",
      quote: "Should spec-writing proceed on the SQL-cron scope?",
      steps: [
        "Click Reopen plan. This unlocks the approved plan so you can edit it again.",
        "Write your answer into the plan, in the section the question is about.",
        "Click Approve plan. The agent reads your answer and goes on writing the specs.",
      ],
      reopen: true,
    });
  });

  it("tells the people of a plan its line already reopened to answer in the plan and Approve, with no Reopen", () => {
    render(
      <PlanRunCard run={asked} state="answering" reopen={async () => ({})} />,
    );
    const panel = screen.getByRole("region", {
      name: "The spec writer has a question for you",
    });

    expect({
      quote: within(panel).getByRole("blockquote").textContent,
      steps: within(panel)
        .getAllByRole("listitem")
        .map((step) => step.textContent),
      buttons: screen.queryAllByRole("button"),
    }).toEqual({
      quote: "Should spec-writing proceed on the SQL-cron scope?",
      steps: [
        "The plan is already open again, so you can edit it.",
        "Write your answer into the plan, in the section the question is about.",
        "Click Approve plan. The agent reads your answer and goes on writing the specs.",
      ],
      buttons: [],
    });
  });
});
