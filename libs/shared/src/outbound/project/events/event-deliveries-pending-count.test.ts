import { describe, expect, it } from "vitest";
import { InMemoryEventDeliveries } from "./event-deliveries-memory.js";

describe("InMemoryEventDeliveries.pendingCount", () => {
  it("counts 2 waiting deliveries for the stations subscriber after one of three is done", async () => {
    const deliveries = new InMemoryEventDeliveries();

    await deliveries.subscribe("stations", [{ eventName: "cron.x.tick" }]);
    await deliveries.subscribe("other", [{ eventName: "cron.x.tick" }]);
    await deliveries.insert({
      eventName: "cron.x.tick",
      source: "cron",
      params: {},
    });
    await deliveries.insert({
      eventName: "cron.x.tick",
      source: "cron",
      params: {},
    });
    await deliveries.insert({
      eventName: "cron.x.tick",
      source: "cron",
      params: {},
    });
    const [first] = await deliveries.claim("stations", 1);

    await deliveries.markDone(first!.id);

    expect(await deliveries.pendingCount("stations")).toEqual(2);
    expect(await deliveries.pendingCount("other")).toEqual(3);
  });
});
