import { describe, it, expect } from "vitest";
import { HttpEventDeliveries } from "./event-deliveries-http.js";
import {
  DeliveryClaimBody,
  OrphanBody,
  SubscribeBody,
} from "./event-deliveries-wire.js";
import { FailBody } from "./event-queue-wire.js";

interface SentCall {
  path: string;
  body: unknown;
}

function client(answer: unknown = {}): {
  port: HttpEventDeliveries;
  sent: SentCall[];
} {
  const sent: SentCall[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({
      path: url.replace("http://router", ""),
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });

    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return {
    port: new HttpEventDeliveries("http://router", "t", fetchImpl),
    sent,
  };
}

describe("HttpEventDeliveries sends what the router parses", () => {
  it("claim carries the subscriber, the limit and the excluded names", async () => {
    const { port, sent } = client({ deliveries: [] });

    await port.claim("stations", 25, ["cron.merge_check.tick"]);

    expect(sent[0]?.path).toBe("/api/deliveries/claim");
    expect(DeliveryClaimBody.parse(sent[0]?.body)).toEqual({
      subscriber: "stations",
      limit: 25,
      excludeEventNames: ["cron.merge_check.tick"],
    });
  });

  it("subscribe carries a zero visibility timeout, which both stores accept", async () => {
    const { port, sent } = client();

    await port.subscribe("stations", [
      { eventName: "station.run", visibilityTimeoutSeconds: 0 },
    ]);

    expect(SubscribeBody.parse(sent[0]?.body)).toEqual({
      subscriber: "stations",
      subscriptions: [
        { eventName: "station.run", visibilityTimeoutSeconds: 0 },
      ],
    });
  });

  it("fail carries the backoff the retry ladder computed", async () => {
    const { port, sent } = client();

    await port.markFailed("d-1", "boom", 30);

    expect(sent[0]?.path).toBe("/api/deliveries/d-1/fail");
    expect(FailBody.parse(sent[0]?.body)).toEqual({
      error: "boom",
      backoffSeconds: 30,
    });
  });

  it("orphanedEvents carries its window", async () => {
    const { port, sent } = client({ orphaned: [] });

    await port.orphanedEvents(60);

    expect(OrphanBody.parse(sent[0]?.body)).toEqual({ withinMinutes: 60 });
  });

  it("ack posts no body, so a bodyless route does not read an empty string", async () => {
    const { port, sent } = client();

    await port.markDone("d-1");

    expect(sent[0]).toEqual({
      path: "/api/deliveries/d-1/ack",
      body: undefined,
    });
  });
});
