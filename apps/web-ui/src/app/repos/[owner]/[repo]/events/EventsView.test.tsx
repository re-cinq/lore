// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EventsView from "./EventsView";
import type { RepoEvent } from "./pagination";

const event = (over: Partial<RepoEvent>): RepoEvent => ({
  id: 1,
  event_name: "github.pull_request.opened",
  source: "github",
  params: { repo: "re-cinq/lore" },
  status: "done",
  captured_at: "2026-06-01T10:00:00.000Z",
  ...over,
});

describe("EventsView", () => {
  it("renders a table row per event with the event name and status", () => {
    render(
      <EventsView
        owner="re-cinq"
        repo="lore"
        hasMore={false}
        events={[
          event({
            id: 1,
            event_name: "github.pull_request.opened",
            source: "github",
            status: "done",
          }),
          event({
            id: 2,
            event_name: "internal.ingest.spec_trace",
            source: "internal",
            status: "pending",
          }),
        ]}
      />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("github.pull_request.opened")).toBeInTheDocument();
    expect(screen.getByText("internal.ingest.spec_trace")).toBeInTheDocument();
    expect(screen.getByText("Done")).toHaveClass("op-badge", "op-done");
  });

  it("shows the empty state and no table when there are no events", () => {
    render(
      <EventsView owner="re-cinq" repo="lore" events={[]} hasMore={false} />,
    );
    expect(screen.getByText("No events yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
