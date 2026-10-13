// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AssemblyRunNode } from "@/lib/assembly-runs";
import type { VisitEvent } from "@/lib/visit-reads";
import NodeOutcomeCard, { outcomePill } from "./NodeOutcomeCard";
import VisitTimingCard from "./VisitTimingCard";
import HumanVisitCard, { answererOf } from "./HumanVisitCard";
import { ModelCallsView } from "./NodeModelCallsCard";
import { EventsView, queueState } from "./NodeEventsCard";
import { AttemptSelectorRow } from "./AttemptSelectorRow";

const attempt = (over: Partial<AssemblyRunNode> = {}): AssemblyRunNode => ({
  nodeId: "ground",
  iteration: 1,
  outcome: "failed",
  agentCrName: null,
  commitSha: null,
  durationSeconds: 30,
  startedAt: "2026-10-10T10:00:00.000Z",
  finishedAt: "2026-10-10T10:00:30.000Z",
  ...over,
});

const event = (over: Partial<VisitEvent> = {}): VisitEvent => ({
  id: "1",
  name: "station_run.dispatch",
  direction: "handled",
  inferred: false,
  created_at: "2026-10-10T10:00:00.000Z",
  acked_at: "2026-10-10T10:00:01.000Z",
  claimed_by: "cluster-agent-1",
  attempts: 1,
  last_error: null,
  dead_at: null,
  payload: { visitId: "visit-1" },
  ...over,
});

describe("NodeOutcomeCard", () => {
  it("shows outcome failed with the error body is too long", () => {
    render(
      <NodeOutcomeCard
        attempt={attempt({ failureDetail: "body is too long" })}
      />,
    );

    expect({
      outcome: screen.getByText("failed") !== null,
      error: screen.getByText("body is too long") !== null,
    }).toEqual({ outcome: true, error: true });
  });

  it("reads In progress for an open visit", () => {
    render(<NodeOutcomeCard attempt={attempt({ outcome: null })} />);

    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("draws cancelled in the idle tone, not as an error", () => {
    expect(outcomePill("cancelled")).toEqual({
      label: "cancelled",
      tone: "idle",
    });
  });
});

describe("VisitTimingCard", () => {
  it("shows a 30s duration for a finished visit", () => {
    render(<VisitTimingCard attempt={attempt()} />);

    expect(screen.getByText("30s")).toBeInTheDocument();
  });

  it("shows running and no finish for an open visit", () => {
    render(
      <VisitTimingCard
        attempt={attempt({ outcome: null, finishedAt: null })}
      />,
    );

    expect({
      running: screen.getByText("running") !== null,
      finished: screen.getByText("—") !== null,
    }).toEqual({ running: true, finished: true });
  });
});

describe("HumanVisitCard", () => {
  it("says why the plan's author visit waits and offers Open the plan", () => {
    render(
      <HumanVisitCard
        nodeType="feature_review"
        attempt={attempt({
          outcome: null,
          routeUrl: "/repos/re-cinq/lore/plans/plan-7",
        })}
      />,
    );

    expect({
      why: screen.getByText(/waiting for you: open the plan/) !== null,
      href: screen
        .getByRole("link", { name: "Open the plan" })
        .getAttribute("href"),
    }).toEqual({ why: true, href: "/repos/re-cinq/lore/plans/plan-7" });
  });

  it("names the event github.pull_request.closed as the answerer once approved", () => {
    render(
      <HumanVisitCard
        nodeType="pr_review"
        attempt={attempt({
          outcome: "success",
          worker: "event:github.pull_request.closed",
        })}
      />,
    );

    expect(
      screen.getByText(/Answered by the event github\.pull_request\.closed/),
    ).toBeInTheDocument();
  });

  it("offers no link when the station resolved no route", () => {
    render(
      <HumanVisitCard
        nodeType="pr_review"
        attempt={attempt({ outcome: null })}
      />,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("calls a reporter with no name someone", () => {
    expect(answererOf(null)).toBe("someone");
  });
});

describe("ModelCallsView", () => {
  it("lists two calls with model, tokens and cost", () => {
    render(
      <ModelCallsView
        calls={[
          {
            seq: 1,
            occurredAt: "t",
            model: "gemini-3.1-pro",
            costUsd: 0.02,
            tokensIn: 1000,
            tokensOut: 120,
          },
          {
            seq: 2,
            occurredAt: "t",
            model: null,
            costUsd: null,
            tokensIn: null,
            tokensOut: null,
          },
        ]}
      />,
    );

    expect(
      screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual(["gemini-3.1-pro1000 / 120$0.0200", "—— / ——"]);
  });

  it("renders nothing for no calls", () => {
    const { container } = render(<ModelCallsView calls={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("EventsView", () => {
  it("groups the dispatch under Handled and the report under Raised", () => {
    render(
      <EventsView
        events={[
          event(),
          event({ id: "2", name: "station_run.reported", direction: "raised" }),
        ]}
      />,
    );

    expect({
      handled: screen
        .getByRole("region", { name: "Handled" })
        .textContent?.includes("station_run.dispatch"),
      raised: screen
        .getByRole("region", { name: "Raised" })
        .textContent?.includes("station_run.reported"),
    }).toEqual({ handled: true, raised: true });
  });

  it("marks an inferred start event as inferred", () => {
    render(
      <EventsView
        events={[event({ name: "node.review.start", inferred: true })]}
      />,
    );

    expect(screen.getByText("inferred")).toBeInTheDocument();
  });

  it("renders nothing for no events", () => {
    const { container } = render(<EventsView events={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("queueState", () => {
  it.each([
    [
      "dead for a dead-lettered event",
      { dead_at: "t", acked_at: null },
      "dead",
    ],
    ["handled for an acknowledged one", {}, "handled"],
    [
      "failed ×3 for one retried after an error",
      { acked_at: null, last_error: "boom", attempts: 3 },
      "failed ×3",
    ],
    ["queued for one nobody took yet", { acked_at: null }, "queued"],
  ] as const)("reads %s", (_name, over, label) => {
    expect(queueState(event(over)).label).toBe(label);
  });
});

describe("AttemptSelectorRow without a Show choice", () => {
  it("renders only the Attempt select when no Show choice is handed in", () => {
    render(
      <AttemptSelectorRow
        attempts={[]}
        selectedIteration={1}
        onAttemptChange={() => {}}
      />,
    );

    expect({
      show: screen.queryByLabelText("Show"),
      attempt: screen.getByLabelText("Attempt") !== null,
    }).toEqual({ show: null, attempt: true });
  });
});
