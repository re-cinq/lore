import { describe, expect, it } from "vitest";
import { floorClientFrom, floorConfigured } from "./floor-client.js";

describe("floor client", () => {
  it("is configured when both the url and the service token are set", () => {
    expect(
      floorConfigured({
        FLOOR_API_URL: "http://floor-api:8080",
        FLOOR_SERVICE_TOKEN: "secret",
      }),
    ).toBe(true);
  });

  it("is not configured when the service token is missing", () => {
    expect(floorConfigured({ FLOOR_API_URL: "http://floor-api:8080" })).toBe(
      false,
    );
  });

  it("refuses to build a client without a url", () => {
    expect(() => floorClientFrom({ FLOOR_SERVICE_TOKEN: "secret" })).toThrow(
      new Error(
        "FLOOR_API_URL and FLOOR_SERVICE_TOKEN must both be set to reach the floor",
      ),
    );
  });

  it("builds a client that serves runs when both are set", () => {
    const floor = floorClientFrom({
      FLOOR_API_URL: "http://floor-api:8080",
      FLOOR_SERVICE_TOKEN: "secret",
    });

    expect(typeof floor.runs.list).toBe("function");
  });
});
