// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import PlanRunCard, { type PlanRun } from "./PlanRunCard";

const RUN: PlanRun = {
  id: "run-1",
  status: "running",
  outcome: null,
  reason: null,
  prUrl: null,
  prNumber: null,
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
  it("says the plan waits for its people and links run-1's page", () => {
    render(
      <PlanRunCard
        run={RUN}
        state="writing"
        draftAgain={async () => ({})}
        reopen={async () => ({})}
      />,
    );

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

  it("links the spec PR once the run opened one", () => {
    render(
      <PlanRunCard
        run={{
          ...RUN,
          prUrl: "https://github.com/re-cinq/lore/pull/7",
          prNumber: 7,
        }}
        state="spec-pr-open"
        draftAgain={async () => ({})}
        reopen={async () => ({})}
      />,
    );

    expect(screen.getByRole("link", { name: "Spec PR #7" })).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore/pull/7",
    );
  });

  it("says no run has started for a plan without one", () => {
    render(
      <PlanRunCard
        run={null}
        state="writing"
        draftAgain={async () => ({})}
        reopen={async () => ({})}
      />,
    );

    expect(screen.getByText("No planning run yet.")).toBeInTheDocument();
  });
});

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("PlanRunCard regenerate", () => {
  const failed = {
    ...RUN,
    status: "failed",
    reason: "no cluster-agent claimed this run",
  };

  it("regenerates the failed plan only after the confirmation popup, then refreshes", async () => {
    const draftAgain = vi.fn(async () => ({}));

    render(
      <PlanRunCard
        run={failed}
        state="writing"
        draftAgain={draftAgain}
        reopen={async () => ({})}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Regenerate plan" }));
    const asked = draftAgain.mock.calls.length;

    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Regenerate",
        }),
      );
    });

    expect({
      asked,
      regenerated: draftAgain.mock.calls.length,
      refreshed: refresh.mock.calls.length,
    }).toEqual({
      asked: 0,
      regenerated: 1,
      refreshed: 1,
    });
  });

  it("closes the popup without regenerating when cancelled", () => {
    const draftAgain = vi.fn(async () => ({}));

    render(
      <PlanRunCard
        run={failed}
        state="writing"
        draftAgain={draftAgain}
        reopen={async () => ({})}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Regenerate plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect({
      dialog: screen.queryByRole("dialog"),
      calls: draftAgain.mock.calls.length,
    }).toEqual({
      dialog: null,
      calls: 0,
    });
  });

  it("warns in the popup that the agent's draft can replace what the plan's sections say", () => {
    render(
      <PlanRunCard
        run={failed}
        state="writing"
        draftAgain={async () => ({})}
        reopen={async () => ({})}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Regenerate plan" }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "can replace what its sections say",
    );
  });

  it("offers a regeneration for a plan no run was ever started for", () => {
    render(
      <PlanRunCard
        run={null}
        state="writing"
        draftAgain={async () => ({})}
        reopen={async () => ({})}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Regenerate plan" }),
    ).toBeInTheDocument();
  });

  it("offers a regeneration while the run waits on its people at author", () => {
    render(
      <PlanRunCard
        run={RUN}
        state="writing"
        draftAgain={async () => ({})}
        reopen={async () => ({})}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Regenerate plan" }),
    ).toBeInTheDocument();
  });
});

describe("PlanRunCard on an approved plan", () => {
  const failedSpecWork = {
    ...RUN,
    status: "failed",
    reason: "the push node reported success but pushed nothing",
  };

  it("offers no regeneration once the spec work failed, and says to retry or reopen instead", () => {
    render(
      <PlanRunCard
        run={failedSpecWork}
        state="spec-work-failed"
        draftAgain={async () => ({})}
        reopen={async () => ({})}
      />,
    );

    expect({
      regenerate: screen.queryByRole("button", { name: "Regenerate plan" }),
      text: screen.getByText(/did not deliver/).textContent,
    }).toEqual({
      regenerate: null,
      text: "The spec work did not deliver. Retry it from the approved plan, or reopen the plan to change it first.",
    });
  });

  const asked = {
    ...RUN,
    specPlanSummary:
      "CHANGES REQUESTED. Should spec-writing proceed on the SQL-cron scope?",
  };

  it("explains that spec writing paused on a question, quotes it without its verdict word, and says to Reopen, answer, then Approve", () => {
    render(
      <PlanRunCard
        run={asked}
        state="question"
        draftAgain={async () => ({})}
        reopen={async () => ({})}
      />,
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
      reopen: within(panel).getByRole("button", { name: "Reopen plan" }) !== null,
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
      <PlanRunCard
        run={asked}
        state="answering"
        draftAgain={async () => ({})}
        reopen={async () => ({})}
      />,
    );
    const panel = screen.getByRole("region", {
      name: "The spec writer has a question for you",
    });

    expect({
      summary: screen.getByText(/Paused/).textContent,
      quote: within(panel).getByRole("blockquote").textContent,
      steps: within(panel)
        .getAllByRole("listitem")
        .map((step) => step.textContent),
      buttons: screen.queryAllByRole("button"),
    }).toEqual({
      summary: "Paused: the spec writing waits for your answer.",
      quote: "Should spec-writing proceed on the SQL-cron scope?",
      steps: [
        "The plan is already open again, so you can edit it.",
        "Write your answer into the plan, in the section the question is about.",
        "Click Approve plan. The agent reads your answer and goes on writing the specs.",
      ],
      buttons: [],
    });
  });

  it("says a reopened plan updates its spec PR on the next approval", () => {
    render(
      <PlanRunCard
        run={RUN}
        state="reopened"
        draftAgain={async () => ({})}
        reopen={async () => ({})}
      />,
    );

    expect(screen.getByText(/Reopened:/).textContent).toContain(
      "approve it again to update the spec PR",
    );
  });
});
