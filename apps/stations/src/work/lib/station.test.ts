import { describe, it, expect } from "vitest";
import { triggerParams, unsupportedPort, type StationHost } from "./station.js";

describe("unsupportedPort", () => {
  it("does not throw when it is merely declared, so a host can be built", () => {
    expect(() => unsupportedPort("repoFor", "lore-api")).not.toThrow();
  });

  it("names the port and the host when something actually reaches for it", () => {
    expect(() => unsupportedPort("repoFor", "lore-api")()).toThrow(
      /station port "repoFor" is not served by the lore-api host/,
    );
  });
});

describe("triggerParams", () => {
  const host = {} as StationHost;

  it("reads an event's params", () => {
    expect(
      triggerParams({
        trigger: "event",
        host,
        event: {
          name: "cron.changelog.tick",
          params: { weeks: 2 },
          eventId: "e1",
        },
      }),
    ).toEqual({ weeks: 2 });
  });

  it("reads an HTTP request's params", () => {
    expect(
      triggerParams({ trigger: "http", host, params: { weeks: 8 } }),
    ).toEqual({ weeks: 8 });
  });

  it("answers empty params for a trigger that carries none", () => {
    expect(triggerParams({ trigger: "cron", host })).toEqual({});
  });
});
