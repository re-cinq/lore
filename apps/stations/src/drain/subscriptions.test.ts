import { describe, it, expect } from "vitest";
import { stationSubscriptions, STATIONS_SUBSCRIBER } from "./subscriptions.js";
import { STATIONS } from "../stations/registry.js";
import { SERVICE_NODE_EVENT } from "@re-cinq/lore-shared/project/events/service-node-event.js";
import { buildStationHandlers } from "./handlers.js";

describe("what the stations service subscribes to", () => {
  it("claims the published-node event, without which a service-form node never runs", () => {
    expect(stationSubscriptions().map((s) => s.eventName)).toContain(
      SERVICE_NODE_EVENT,
    );
  });

  it("claims every event name a station's manifest declares", () => {
    const declared = Object.values(STATIONS).flatMap((mod) =>
      mod.manifest.triggers
        .filter((t) => t.kind === "event")
        .flatMap((t) => t.eventNames),
    );

    for (const name of declared) {
      expect(stationSubscriptions().map((s) => s.eventName)).toContain(name);
    }
  });

  it("subscribes each name once, so one delivery is not asked for twice", () => {
    const names = stationSubscriptions().map((s) => s.eventName);

    expect(names.length).toBe(new Set(names).size);
  });

  it("gives the published-node subscription a budget long enough for the slowest node", () => {
    const slowest = Math.max(
      ...Object.values(STATIONS).flatMap((mod) =>
        mod.manifest.triggers
          .filter((t) => t.kind === "node" && t.runtime === "service")
          .map((t) => (t as { timeoutMinutes: number }).timeoutMinutes),
      ),
    );
    const sub = stationSubscriptions().find(
      (s) => s.eventName === SERVICE_NODE_EVENT,
    );

    expect(sub?.visibilityTimeoutSeconds).toBeGreaterThanOrEqual(slowest * 60);
  });

  it("names one subscriber for the whole service, since two replicas share a backlog", () => {
    expect(STATIONS_SUBSCRIBER).toBe("stations");
  });
});

describe("every subscription has something to handle it", () => {
  it("maps a handler for each name it subscribes to, so nothing dead-letters on arrival", () => {
    const handlers = buildStationHandlers();
    const unhandled = stationSubscriptions()
      .map((s) => s.eventName)
      .filter((name) => !handlers.has(name));

    expect(unhandled).toEqual([]);
  });

  it("handles no name it did not subscribe to, which it would never receive", () => {
    const subscribed = new Set(stationSubscriptions().map((s) => s.eventName));
    const orphans = [...buildStationHandlers().keys()].filter(
      (name) => !subscribed.has(name),
    );

    expect(orphans).toEqual([]);
  });
});
