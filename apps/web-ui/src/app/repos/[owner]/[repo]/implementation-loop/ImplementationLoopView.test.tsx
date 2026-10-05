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
  const toggle = vi.fn(async () => {});
  const retryOnboarding = vi.fn(async () => {});
  const rendered = render(
    <ImplementationLoopView
      loop={{
        enabled: false,
        onboarding: { merged: true, pr_url: null, last_task: null },
        current: null,
        current_run_id: null,
        next: [],
        parked: [],
        recent: [],
        ...loop,
      }}
      toggle={toggle}
      retryOnboarding={retryOnboarding}
    />,
  );

  return { ...rendered, toggle, retryOnboarding };
}

describe("ImplementationLoopView", () => {
  it("explains how to queue a ticket and how the loop works", () => {
    const { getAllByText } = renderView();

    expect(
      getAllByText(/Label an open issue with exactly one of/).length,
    ).toBeGreaterThan(0);
    expect(getAllByText(/priority:high/).length).toBeGreaterThan(0);
    expect(getAllByText(/lore:blocked/).length).toBeGreaterThan(0);
    expect(getAllByText(/never merges/).length).toBeGreaterThan(0);
    expect(
      getAllByText(/remove the label to re-queue/i).length,
    ).toBeGreaterThan(0);
  });

  it("explains that a ticket blocked by an open issue waits unlabelled until its last blocker closes", () => {
    const { getAllByText } = renderView();

    expect(
      getAllByText(/waits instead: it gets no label/).length,
    ).toBeGreaterThan(0);
  });

  it("renders a mini pipeline dot per node, linked to the run", () => {
    const { getByTestId } = renderView({
      current: ticket({
        state: "running",
        run_id: "run-42",
        pipeline: [
          { node_id: "implement", state: "success" },
          { node_id: "validate", state: "running" },
          { node_id: "await-pr", state: "waiting" },
          { node_id: "push", state: "exploded" },
        ],
      }),
    });

    expect(getByTestId("mini-pipeline").getAttribute("href")).toBe(
      "/assembly-runs/run-42",
    );
    expect(getByTestId("mini-node-implement").className).toContain("success");
    expect(getByTestId("mini-node-validate").className).toContain("running");
    expect(getByTestId("mini-node-await-pr").className).toContain("waiting");
    expect(getByTestId("mini-node-implement").getAttribute("title")).toBe(
      "implement: success",
    );
    expect(getByTestId("mini-node-push").className).toContain("failed");
  });

  it("renders no mini pipeline for a queued ticket with no run", () => {
    const { queryByTestId } = renderView({ next: [ticket()] });

    expect(queryByTestId("mini-pipeline")).toBeNull();
  });

  it("renders worked tickets as table rows with status, ticket, stages, actions", () => {
    const { getByTestId, getByText } = renderView({
      current: ticket({
        state: "running",
        run_id: "run-42",
        created_at: "2026-08-26T06:00:00Z",
        pr_url: "https://gh/pr/70",
      }),
    });

    expect(getByTestId("ticket-table")).toBeTruthy();
    expect(getByTestId("ticket-status").textContent).toBe("running");
    expect(getByTestId("ticket-status").className).toContain("tone_info");
    expect(getByTestId("ticket-time").getAttribute("title")).toBe(
      "2026-08-26T06:00:00Z",
    );
    expect((getByText("Run") as HTMLAnchorElement).getAttribute("href")).toBe(
      "/assembly-runs/run-42",
    );
    expect((getByText("PR") as HTMLAnchorElement).getAttribute("href")).toBe(
      "https://gh/pr/70",
    );
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
      current: ticket({ state: "running", run_id: "run-9" }),
    });

    expect(queryByTestId("ticket-hold-7")).toBeNull();
  });

  it("badges an unknown task status in the danger tone", () => {
    const { getByTestId } = renderView({
      current: ticket({ state: "haunted", created_at: null }),
    });

    expect(getByTestId("ticket-status").className).toContain("tone_danger");
  });

  it("says plainly when no ticket is in flight instead of an empty container", () => {
    const { getByText } = renderView();

    expect(getByText("No ticket is being worked right now.")).toBeTruthy();
  });

  it("renders the current ticket with issue and PR links", () => {
    const { getByText } = renderView({
      current: ticket({ pr_url: "https://gh/pr/70", state: "running" }),
    });

    const issueLink = getByText("#7 Slow queries") as HTMLAnchorElement;

    expect(issueLink.href).toBe("https://gh/i/7");
    expect((getByText("PR") as HTMLAnchorElement).href).toBe(
      "https://gh/pr/70",
    );
    expect(getByText("running")).toBeTruthy();
  });

  it("renders the queue in order even while the loop is disabled", () => {
    const { getByText, container } = renderView({
      next: [
        ticket(),
        ticket({
          issue_number: 9,
          title: "Flaky test",
          priority: "priority:low",
        }),
      ],
    });

    expect(getByText("Enable loop")).toBeTruthy();
    const rows = Array.from(container.querySelectorAll("a")).map(
      (a) => a.textContent,
    );

    expect(rows).toEqual(["#7 Slow queries", "#9 Flaky test"]);
  });

  it("explains the priority labels when the backlog is empty", () => {
    const { getByText } = renderView();

    expect(getByText(/Label an issue priority:high/)).toBeTruthy();
  });

  it("flips the toggle through the bound action", () => {
    const { getByText, toggle } = renderView({ enabled: true });

    fireEvent.click(getByText("Disable loop"));

    expect(toggle).toHaveBeenCalledWith({ enabled: false });
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

describe("timeAgo", () => {
  const now = new Date("2026-08-26T10:00:00Z");

  it("renders seconds, minutes, hours, and days at the right unit", async () => {
    const { timeAgo } = await import("./ImplementationLoopView");

    expect(timeAgo("2026-08-26T09:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-08-26T09:57:00Z", now)).toBe("3 minutes ago");
    expect(timeAgo("2026-08-26T09:00:00Z", now)).toBe("1 hour ago");
    expect(timeAgo("2026-08-24T10:00:00Z", now)).toBe("2 days ago");
    expect(timeAgo(null, now)).toBe("");
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
    fix: "Fix what it names, then remove the lore:blocked label to re-queue it.",
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

    expect(getByRole("heading", { name: "Parked" })).toBeTruthy();
    expect(getByTestId("ticket-status").textContent).toEqual("parked");
    expect(queryByTestId("ticket-hold-kind")).toBeNull();
    expect(getByTestId("ticket-hold-7").textContent).toEqual(
      "The loop parked this ticket: it asks for a decision.Fix: Fix what it names, then remove the lore:blocked label to re-queue it.",
    );
  });

  it("shows no Parked heading when nothing is parked", () => {
    const { queryByRole } = renderView();

    expect(queryByRole("heading", { name: "Parked" })).toBeNull();
  });

  it("heads the queue Paused and says to enable the loop while it is switched off", () => {
    const { getByRole, getByTestId, queryByRole } = renderView({
      enabled: false,
      next: [ticket()],
    });

    expect(
      getByRole("heading", { name: "Paused: the loop is switched off" }),
    ).toBeTruthy();
    expect(queryByRole("heading", { name: "Next up" })).toBeNull();
    expect(getByTestId("section-notice").textContent).toEqual(
      "Nothing is picked until the loop is enabled. Use Enable loop above.",
    );
  });

  it("heads the queue Next up with no notice while the loop is on", () => {
    const { getByRole, queryByTestId } = renderView({ enabled: true });

    expect(getByRole("heading", { name: "Next up" })).toBeTruthy();
    expect(queryByTestId("section-notice")).toBeNull();
  });
});
