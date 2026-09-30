import { describe, expect, it } from "vitest";
import { turnsUpstream } from "./run-turns-upstream";

const FLOOR = { upstreamUrl: "http://lore-floor", token: "floor-token" };
const LORE_API = { upstreamUrl: "http://lore-api", token: "api-token" };

describe("turnsUpstream", () => {
  it("reads a floor run's turns from lore-api", () => {
    expect(
      turnsUpstream({ id: "run-1", engine: "floor" }, FLOOR, LORE_API),
    ).toEqual({
      url: "http://lore-api/api/assembly-runs/run-1/turns",
      token: "api-token",
    });
  });

  it("reads a lore run's turns from the Floor", () => {
    expect(
      turnsUpstream({ id: "run-1", engine: "lore" }, FLOOR, LORE_API),
    ).toEqual({
      url: "http://lore-floor/api/agent-turns/run-1",
      token: "floor-token",
    });
  });

  it("reads from the Floor when no lore-api is configured", () => {
    expect(
      turnsUpstream({ id: "run-1", engine: "floor" }, FLOOR, null),
    ).toEqual({
      url: "http://lore-floor/api/agent-turns/run-1",
      token: "floor-token",
    });
  });
});
