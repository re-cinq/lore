import { describe, it, expect } from "vitest";
import { localEventProxy } from "./select-event-reporter.js";
import { InMemoryEventReporter } from "./event-reporter-memory.js";

describe("localEventProxy", () => {
  it("inserts straight through to the local queue, so an ingress route still sees the failure", async () => {
    const local = new InMemoryEventReporter();

    const proxy = localEventProxy({ local: () => local });

    await proxy.insert({ eventName: "ci.tests.reported", source: "internal" });

    expect(local.rows.map((row) => row.event_name)).toEqual([
      "ci.tests.reported",
    ]);
  });

  it("queues an emitted message rather than delivering it inline", async () => {
    const local = new InMemoryEventReporter();

    const proxy = localEventProxy({ local: () => local });

    await proxy.emit({
      kind: "event",
      event: { eventName: "kubernetes.agent.succeeded", source: "kubernetes" },
    });

    expect({
      depth: proxy.depth,
      captured: local.rows.length,
    }).toEqual({ depth: 1, captured: 0 });
  });
});
