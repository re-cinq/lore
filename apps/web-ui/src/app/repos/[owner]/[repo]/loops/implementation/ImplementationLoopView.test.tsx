// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import ImplementationLoopView from "./ImplementationLoopView";
import type { ImplementationLoop, LoopTicket } from "@/lib/api/backlog";

const ticket = (over: Partial<LoopTicket> = {}): LoopTicket => ({
  issue_number: 7,
  issue_url: "https://gh/i/7",
  title: "Slow queries",
  priority: "priority:high",
  pr_url: null,
  state: "queued",
  created_at: "2026-08-01T00:00:00Z",
  hold: null,
  run_id: null,
  pipeline: null,
  ...over,
});

function renderView(loop: Partial<ImplementationLoop> = {}) {
  const retryOnboarding = vi.fn(async () => {});
  const rendered = render(
    <ImplementationLoopView
      loop={{
        enabled: false,
        onboarding: { merged: true, pr_url: null, last_task: null },
        current: [],
        current_run_id: null,
        next: [],
        parked: [],
        recent: [],
        awaiting_merge: [],
        ...loop,
      }}
      retryOnboarding={retryOnboarding}
    />,
  );

  return { ...rendered, retryOnboarding };
}

describe("ImplementationLoopView", () => {
  it("explains how to queue a ticket and how the loop works", () => {
    const { getAllByText } = renderView();

    const said = (pattern: RegExp) => getAllByText(pattern).length > 0;

    expect(
      [
        /Label an open issue with exactly one of/,
        /priority:high/,
        /lore:blocked/,
        /never merges/,
        /remove the label to re-queue/i,
      ].every(said),
    ).toBe(true);
  });

  it("explains that a ticket blocked by an open issue waits unlabelled until its last blocker closes", () => {
    const { getAllByText } = renderView();

    expect(
      getAllByText(/waits instead: it gets no label/).length,
    ).toBeGreaterThan(0);
  });

  it("renders a mini pipeline dot per node, linked to the run", () => {
    const { getByTestId } = renderView({
      current: [
        ticket({
          state: "running",
          run_id: "run-42",
          pipeline: [
            { node_id: "implement", state: "success" },
            { node_id: "validate", state: "running" },
            { node_id: "await-pr", state: "waiting" },
            { node_id: "push", state: "exploded" },
          ],
        }),
      ],
    });

    const toneOf = (node: string) =>
      getByTestId(`mini-node-${node}`).className.match(
        /success|running|waiting|failed/,
      )?.[0];

    expect({
      href: getByTestId("mini-pipeline").getAttribute("href"),
      title: getByTestId("mini-node-implement").getAttribute("title"),
      tones: ["implement", "validate", "await-pr", "push"].map(toneOf),
    }).toEqual({
      href: "/assembly-runs/run-42",
      title: "implement: success",
      tones: ["success", "running", "waiting", "failed"],
    });
  });

  it("renders no mini pipeline for a queued ticket with no run", () => {
    const { queryByTestId } = renderView({ next: [ticket()] });

    expect(queryByTestId("mini-pipeline")).toBeNull();
  });

  it("renders worked tickets as table rows with status, ticket, stages, actions", () => {
    const { getByTestId, getByText } = renderView({
      current: [
        ticket({
          state: "running",
          run_id: "run-42",
          created_at: "2026-08-26T06:00:00Z",
          pr_url: "https://gh/pr/70",
        }),
      ],
    });

    expect({
      table: Boolean(getByTestId("ticket-table")),
      status: getByTestId("ticket-status").textContent,
      tone: getByTestId("ticket-status").className.includes("tone_info"),
      time: getByTestId("row-time").getAttribute("title"),
      run: getByText("Run").getAttribute("href"),
      pr: getByText("PR").getAttribute("href"),
    }).toEqual({
      table: true,
      status: "running",
      tone: true,
      time: "2026-08-26T06:00:00Z",
      run: "/assembly-runs/run-42",
      pr: "https://gh/pr/70",
    });
  });

  it("shows why the failed #7 failed and how to fix it on its row", () => {
    const { getByTestId } = renderView({
      recent: [
        ticket({
          state: "failed",
          run_id: "run-9",
          hold: {
            kind: "failed",
            message: "The last attempt failed: the run ended failed: 403.",
            fix: "Check the Lore GitHub App's repository permissions.",
          },
        }),
      ],
    });

    expect(getByTestId("ticket-hold-7").textContent).toEqual(
      "The last attempt failed: the run ended failed: 403.Fix: Check the Lore GitHub App's repository permissions.",
    );
  });

  it("renders no hold on a running ticket nothing holds", () => {
    const { queryByTestId } = renderView({
      current: [ticket({ state: "running", run_id: "run-9" })],
    });

    expect(queryByTestId("ticket-hold-7")).toBeNull();
  });

  it("badges an unknown task status in the danger tone", () => {
    const { getByTestId } = renderView({
      current: [ticket({ state: "haunted", created_at: null })],
    });

    expect(getByTestId("ticket-status").className).toContain("tone_danger");
  });

  it("says plainly when no ticket is in flight instead of an empty container", () => {
    const { getByText } = renderView();

    expect(getByText("No ticket is being worked right now.")).toBeTruthy();
  });

  it("lists two current tickets together, the loop's own pick and a by-hand-revived one", () => {
    const { getAllByTestId } = renderView({
      current: [
        ticket({ issue_number: 7, state: "running" }),
        ticket({ issue_number: 158, title: "Revived ticket", state: "failed" }),
      ],
    });

    expect(getAllByTestId("ticket-row")).toHaveLength(2);
  });

  it("renders the current ticket with issue and PR links", () => {
    const { getByText } = renderView({
      current: [ticket({ pr_url: "https://gh/pr/70", state: "running" })],
    });

    const issueLink = getByText("#7 Slow queries") as HTMLAnchorElement;

    expect(issueLink.href).toBe("https://gh/i/7");
    expect((getByText("PR") as HTMLAnchorElement).href).toBe(
      "https://gh/pr/70",
    );
    expect(getByText("running")).toBeTruthy();
  });

  it("renders the queue in order even while the loop is disabled", () => {
    const { container } = renderView({
      next: [
        ticket(),
        ticket({
          issue_number: 9,
          title: "Flaky test",
          priority: "priority:low",
        }),
      ],
    });

    const rows = Array.from(container.querySelectorAll("a")).map(
      (a) => a.textContent,
    );

    expect(rows).toEqual(["#7 Slow queries", "#9 Flaky test"]);
  });

  it("explains the priority labels when the backlog is empty", () => {
    const { getByText } = renderView();

    expect(getByText(/Label an issue priority:high/)).toBeTruthy();
  });

  it("lists recently addressed tickets with their state", () => {
    const { getByText } = renderView({
      recent: [
        ticket({
          pr_url: "https://gh/pr/70",
          state: "completed",
          priority: null,
        }),
      ],
    });

    expect(getByText("completed")).toBeTruthy();
  });
});

describe("ImplementationLoopView when the repo is not onboarded", () => {
  it("says the loop picks nothing, shows why onboarding failed, and offers to retry it", () => {
    const { getByText, getByRole, retryOnboarding } = renderView({
      enabled: true,
      onboarding: {
        merged: false,
        pr_url: null,
        last_task: {
          id: "d5602eb8",
          status: "failed",
          failure_reason: "Git Repository is empty.",
          in_flight: false,
        },
      },
    });

    expect(getByText(/won't pick tickets/)).toBeTruthy();
    expect(getByText(/Git Repository is empty\./)).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "Retry onboarding" }));
    expect(retryOnboarding).toHaveBeenCalledTimes(1);
  });

  it("links to the open onboarding PR instead of offering a retry while one waits to merge", () => {
    const { getByRole, queryByRole } = renderView({
      enabled: true,
      onboarding: {
        merged: false,
        pr_url: "https://github.com/re-cinq/Otto/pull/216",
        last_task: {
          id: "t2",
          status: "pr-created",
          failure_reason: null,
          in_flight: true,
        },
      },
    });

    expect(
      getByRole("link", { name: "Merge the onboarding PR" }).getAttribute(
        "href",
      ),
    ).toBe("https://github.com/re-cinq/Otto/pull/216");
    expect(queryByRole("button", { name: "Retry onboarding" })).toBeNull();
  });

  it("links to the running onboarding task instead of offering a retry", () => {
    const { getByRole, queryByRole } = renderView({
      enabled: true,
      onboarding: {
        merged: false,
        pr_url: null,
        last_task: {
          id: "t3",
          status: "running",
          failure_reason: null,
          in_flight: true,
        },
      },
    });

    expect(
      getByRole("link", { name: "Onboarding is running" }).getAttribute("href"),
    ).toBe("/assembly-runs/t3");
    expect(queryByRole("button", { name: "Retry onboarding" })).toBeNull();
  });

  it("offers to onboard a repo that was never onboarded, without calling it a failure", () => {
    const { getByRole, queryByText, retryOnboarding } = renderView({
      enabled: true,
      onboarding: { merged: false, pr_url: null, last_task: null },
    });

    expect(queryByText(/Onboarding failed/)).toBeNull();
    fireEvent.click(getByRole("button", { name: "Onboard this repo" }));
    expect(retryOnboarding).toHaveBeenCalledTimes(1);
  });

  it("heads the queue Waiting for onboarding instead of Next up, so it does not read as about to start", () => {
    const { getByRole, queryByRole } = renderView({
      enabled: true,
      onboarding: { merged: false, pr_url: null, last_task: null },
    });

    expect(
      getByRole("heading", { name: "Waiting for onboarding" }),
    ).toBeTruthy();
    expect(queryByRole("heading", { name: "Next up" })).toBeNull();
  });
});

describe("ImplementationLoopView with tickets the loop is not working", () => {
  const blockers = {
    kind: "waits_on_blockers" as const,
    message: "Waits on #12, which is still open.",
    fix: "Close them, or remove the blocked-by link if it no longer applies.",
  };
  const parked = {
    kind: "parked" as const,
    message: "The loop parked this ticket: it asks for a decision.",
    fix: "Fix what it names, then remove the lore:blocked label on the issue — the loop re-queues it on its own next tick, no need to run anything by hand.",
  };

  it("pills the queued #7 waits on blockers with its reason and fix, and leaves #8 bare", () => {
    const { getAllByTestId, getByTestId, queryByTestId } = renderView({
      next: [
        ticket({ hold: blockers }),
        ticket({ issue_number: 8, title: "Short issue" }),
      ],
    });

    expect(
      getAllByTestId("ticket-hold-kind").map((pill) => pill.textContent),
    ).toEqual(["waits on blockers"]);
    expect(getByTestId("ticket-hold-7").textContent).toEqual(
      "Waits on #12, which is still open.Fix: Close them, or remove the blocked-by link if it no longer applies.",
    );
    expect(queryByTestId("ticket-hold-8")).toBeNull();
  });

  it("words the text_too_long pill as text too long", () => {
    const { getByTestId } = renderView({
      next: [
        ticket({
          hold: {
            kind: "text_too_long",
            message: "The issue's title and body are longer than allowed.",
            fix: "Shorten the issue text.",
          },
        }),
      ],
    });

    expect(getByTestId("ticket-hold-kind").textContent).toEqual(
      "text too long",
    );
  });

  it("lists the parked #7 under a Parked heading, badged parked once, with its reason and fix", () => {
    const { getByRole, getByTestId, queryByTestId } = renderView({
      parked: [ticket({ state: "parked", hold: parked })],
    });

    expect({
      heading: getByRole("heading", { name: "Parked" }).textContent,
      status: getByTestId("ticket-status").textContent,
      kindPill: queryByTestId("ticket-hold-kind"),
      hold: getByTestId("ticket-hold-7").textContent,
    }).toEqual({
      heading: "Parked",
      status: "parked",
      kindPill: null,
      hold: "The loop parked this ticket: it asks for a decision.Fix: Fix what it names, then remove the lore:blocked label on the issue — the loop re-queues it on its own next tick, no need to run anything by hand.",
    });
  });

  it("shows no Parked heading when nothing is parked", () => {
    const { queryByRole } = renderView();

    expect(queryByRole("heading", { name: "Parked" })).toBeNull();
  });

  it("lists an awaiting-merge ticket under its own heading with the pill and fix", () => {
    const awaitingMerge = {
      kind: "awaiting_merge" as const,
      message: "The loop's pull request is open and still awaiting a merge.",
      fix: "Review and merge the pull request to free this ticket's slot.",
    };
    const { getByRole, getByTestId } = renderView({
      awaiting_merge: [
        ticket({
          state: "completed",
          pr_url: "https://gh/pr/7",
          hold: awaitingMerge,
        }),
      ],
    });

    expect(getByRole("heading", { name: "Awaiting merge" })).toBeTruthy();
    expect(getByTestId("ticket-hold-kind").textContent).toEqual(
      "awaiting merge",
    );
    expect(getByTestId("ticket-hold-7").textContent).toEqual(
      "The loop's pull request is open and still awaiting a merge.Fix: Review and merge the pull request to free this ticket's slot.",
    );
  });

  it("shows no Awaiting merge heading when nothing is awaiting merge", () => {
    const { queryByRole } = renderView();

    expect(queryByRole("heading", { name: "Awaiting merge" })).toBeNull();
  });

  it("heads the queue Paused and says to switch the loop on while it is off", () => {
    const { getByRole, getByTestId, queryByRole } = renderView({
      enabled: false,
      next: [ticket()],
    });

    expect(
      getByRole("heading", { name: "Paused: the loop is switched off" }),
    ).toBeTruthy();
    expect(queryByRole("heading", { name: "Next up" })).toBeNull();
    expect(getByTestId("section-notice").textContent).toEqual(
      "Nothing is picked until the loop is switched on above.",
    );
  });

  it("heads the queue Next up with no notice while the loop is on", () => {
    const { getByRole, queryByTestId } = renderView({ enabled: true });

    expect(getByRole("heading", { name: "Next up" })).toBeTruthy();
    expect(queryByTestId("section-notice")).toBeNull();
  });
});
