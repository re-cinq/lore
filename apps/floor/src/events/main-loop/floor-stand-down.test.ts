import { afterEach, describe, expect, it, vi } from "vitest";
import { unlessOnTheFloor } from "./floor-stand-down.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function tickedHandler() {
  const ticks: unknown[] = [];
  const handler = unlessOnTheFloor(async (params) => {
    ticks.push(params);
  });

  return { handler, ticks };
}

describe("unlessOnTheFloor", () => {
  it("runs the handler with the tick's params on a deployment with no floor", async () => {
    vi.stubEnv("FLOOR_API_URL", "");
    const { handler, ticks } = tickedHandler();

    await handler({ repo: "acme/widgets" });

    expect(ticks).toEqual([{ repo: "acme/widgets" }]);
  });

  it("stands down, running nothing, where a floor is configured", async () => {
    vi.stubEnv("FLOOR_API_URL", "http://floor.test");
    vi.stubEnv("FLOOR_SERVICE_TOKEN", "token");
    const { handler, ticks } = tickedHandler();

    await handler({ repo: "acme/widgets" });

    expect(ticks).toEqual([]);
  });
});
