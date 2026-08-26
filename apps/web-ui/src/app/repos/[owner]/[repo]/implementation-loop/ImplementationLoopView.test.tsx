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
  ...over,
});

function renderView(loop: Partial<ImplementationLoop> = {}) {
  const toggle = vi.fn(async () => {});
  const utils = render(
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

  return { ...utils, toggle };
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

  it("links the live pipeline view when a run is in flight", () => {
    const { getByText } = renderView({
      current: ticket({ state: "running" }),
      current_run_id: "run-42",
    });

    expect(
      (getByText("Live pipeline view →") as HTMLAnchorElement).getAttribute(
        "href",
      ),
    ).toBe("/assembly-runs/run-42");
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
