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
  error: null,
  run_id: null,
  pipeline: null,
  ...over,
});

function renderView(loop: Partial<ImplementationLoop> = {}) {
  const toggle = vi.fn(async () => {});
  const rendered = render(
    <ImplementationLoopView
      loop={{
        enabled: false,
        current: null,
        current_run_id: null,
        next: [],
        recent: [],
        ...loop,
      }}
      toggle={toggle}
    />,
  );

  return { ...rendered, toggle };
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

  it("shows the run's error message on a failed ticket row", () => {
    const { getByTestId } = renderView({
      recent: [
        ticket({
          state: "failed",
          run_id: "run-9",
          error:
            "AssemblyLine implementation-loop: edge validate->implement exceeded iteration_max 1",
        }),
      ],
    });

    expect(getByTestId("ticket-error-7").textContent).toContain(
      "edge validate->implement exceeded iteration_max 1",
    );
  });

  it("renders no error line when the run has none", () => {
    const { queryByTestId } = renderView({
      current: ticket({ state: "running", run_id: "run-9" }),
    });

    expect(queryByTestId("ticket-error-7")).toBeNull();
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

    expect(toggle).toHaveBeenCalledWith(false);
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
