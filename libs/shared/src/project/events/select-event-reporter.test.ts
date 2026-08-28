import { describe, it, expect } from "vitest";
import {
  selectEventProxy,
  selectEventReporter,
} from "./select-event-reporter.js";
import { HttpEventReporter } from "./event-reporter-http.js";
import { InMemoryEventQueue } from "./event-queue-memory.js";

const silent = (): void => {};

describe("selectEventReporter", () => {
  it("reports over HTTP when EVENT_ROUTER_URL names a router", () => {
    const reporter = selectEventReporter({
      local: () => new InMemoryEventQueue(),
      env: { EVENT_ROUTER_URL: "https://router.example" },
      log: silent,
    });

    expect(reporter).toBeInstanceOf(HttpEventReporter);
  });

  it("never resolves the local queue when a router is configured", () => {
    let resolved = 0;

    selectEventReporter({
      local: () => {
        resolved++;

        return new InMemoryEventQueue();
      },
      env: { EVENT_ROUTER_URL: "https://router.example" },
      log: silent,
    });

    expect(resolved).toBe(0);
  });

  it("falls back to the local queue when EVENT_ROUTER_URL is unset", () => {
    const local = new InMemoryEventQueue();

    const reporter = selectEventReporter({
      local: () => local,
      env: {},
      log: silent,
    });

    expect(reporter).toBe(local);
  });

  it("says which way it resolved, so a cluster that lost the url is not silent", () => {
    const lines: string[] = [];

    selectEventReporter({
      local: () => new InMemoryEventQueue(),
      env: {},
      log: (m) => lines.push(m),
    });

    expect(lines).toEqual([
      "[events] EVENT_ROUTER_URL unset — reporting directly to pipeline.events (local mode)",
    ]);
  });
});

describe("selectEventProxy", () => {
  it("inserts straight through to the local queue, so an ingress route still sees the failure", async () => {
    const local = new InMemoryEventQueue();

    const proxy = selectEventProxy({
      local: () => local,
      env: {},
      log: silent,
    });

    await proxy.insert({ eventName: "ci.tests.reported", source: "internal" });

    expect((await local.claimBatch(10)).map((row) => row.event_name)).toEqual([
      "ci.tests.reported",
    ]);
  });

  it("queues an emitted message rather than delivering it inline", async () => {
    const local = new InMemoryEventQueue();

    const proxy = selectEventProxy({
      local: () => local,
      env: {},
      log: silent,
    });

    await proxy.emit({
      kind: "event",
      event: { eventName: "kubernetes.agent.succeeded", source: "kubernetes" },
    });

    expect({
      depth: proxy.depth,
      claimed: (await local.claimBatch(10)).length,
    }).toEqual({ depth: 1, claimed: 0 });
  });

  it("never resolves the local queue when a router is configured, so a pool-less process can hold one", () => {
    let resolved = 0;

    selectEventProxy({
      local: () => {
        resolved++;

        return new InMemoryEventQueue();
      },
      env: { EVENT_ROUTER_URL: "https://router.example" },
      log: silent,
    });

    expect(resolved).toBe(0);
  });
});
