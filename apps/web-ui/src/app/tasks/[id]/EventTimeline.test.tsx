// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EventTimeline from "./EventTimeline";
import type { TaskRuntimeEvent } from "@/lib/task-runtime";

const event = (over: Partial<TaskRuntimeEvent> = {}): TaskRuntimeEvent => ({
  id: "e1",
  from_status: "pending",
  to_status: "running",
  metadata: null,
  created_at: "2026-07-15T10:00:00Z",
  ...over,
});

describe("EventTimeline", () => {
  it("renders a badge per transition with the from-status", () => {
    render(
      <EventTimeline
        events={[event(), event({ id: "e2", to_status: "failed" })]}
      />,
    );

    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders metadata as pretty JSON when present", () => {
    render(
      <EventTimeline events={[event({ metadata: { feedback: "redo" } })]} />,
    );

    expect(screen.getByText(/"feedback": "redo"/)).toBeInTheDocument();
  });

  it("renders an empty-state note when there are no events", () => {
    render(<EventTimeline events={[]} />);

    expect(
      screen.getByText("No events recorded for this task."),
    ).toBeInTheDocument();
  });
});
