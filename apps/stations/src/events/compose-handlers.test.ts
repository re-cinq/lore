import { describe, expect, it } from "vitest";
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import { addHandlers } from "./compose-handlers.js";

function recording(name: string, calls: string[]): EventHandler {
  return async (params) => {
    calls.push(`${name}:${String(params.pr_number)}`);
  };
}

describe("addHandlers", () => {
  it("answers github.pull_request.closed with both handlers when two own it", async () => {
    const calls: string[] = [];
    const registry = new Map([
      ["github.pull_request.closed", recording("reviews", calls)],
    ]);

    addHandlers(
      registry,
      new Map([["github.pull_request.closed", recording("plans", calls)]]),
    );
    await registry.get("github.pull_request.closed")!({ pr_number: 12 });

    expect(calls.sort()).toEqual(["plans:12", "reviews:12"]);
  });

  it("adds a handler under a name nothing answers yet as it is", () => {
    const registry = new Map<string, EventHandler>();
    const handler = recording("plans", []);

    addHandlers(registry, new Map([["github.pull_request.closed", handler]]));

    expect(registry.get("github.pull_request.closed")).toBe(handler);
  });

  it("rejects when one of the two fails, after the other ran, so the bus retries both", async () => {
    const calls: string[] = [];
    const failing: EventHandler = async () => {
      throw new Error("floor unreachable");
    };
    const registry = new Map([["github.pull_request.closed", failing]]);

    addHandlers(
      registry,
      new Map([["github.pull_request.closed", recording("plans", calls)]]),
    );

    await expect(
      registry.get("github.pull_request.closed")!({ pr_number: 12 }),
    ).rejects.toThrow(new Error("floor unreachable"));
    expect(calls).toEqual(["plans:12"]);
  });
});
