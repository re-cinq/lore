import { describe, it, expect } from "vitest";
import { EventSink, UnconfiguredSink } from "./event-sink.js";
import { InMemoryEventReporter } from "./event-reporter-memory.js";

describe("EventSink", () => {
  it("unwraps an event message into an insert on the reporter", async () => {
    const queue = new InMemoryEventReporter();

    await new EventSink(queue).deliver({
      kind: "event",
      event: { eventName: "kubernetes.agent.succeeded", source: "kubernetes" },
    });

    expect(queue.rows.map((row) => row.event_name)).toEqual([
      "kubernetes.agent.succeeded",
    ]);
  });

  it("refuses a telemetry message, because routing by kind is the proxy's job", async () => {
    await expect(
      new EventSink(new InMemoryEventReporter()).deliver({
        kind: "telemetry",
        body: "{}",
      }),
    ).rejects.toThrow(
      new Error(
        "EventSink received a telemetry message — the proxy routes by kind and should never send one here",
      ),
    );
  });
});

describe("UnconfiguredSink", () => {
  it("refuses rather than dropping, so the proxy logs the message it lost", async () => {
    await expect(new UnconfiguredSink("telemetry").deliver()).rejects.toThrow(
      new Error("no telemetry sink is configured for this process"),
    );
  });
});
