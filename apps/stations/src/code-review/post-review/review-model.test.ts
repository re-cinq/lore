import { describe, expect, it } from "vitest";
import type { VisitView } from "@re-cinq/floor-client";
import { modelsOf, producingVisitOf } from "./review-model.js";

function visit(overrides: Partial<VisitView>): VisitView {
  return {
    id: "visit-1",
    runId: "run-1",
    nodeId: "review",
    iteration: 1,
    stationHash: null,
    agentDefinitionHash: null,
    brief: { iteration: 1, needs: {} },
    report: { outcome: "success" },
    worker: null,
    requestedBy: null,
    branch: null,
    deadline: null,
    resumedFrom: null,
    agentSettings: {
      model: "gemini-3.1-pro-preview",
      prompt: "review",
      image: "img",
      timeoutMinutes: 30,
    },
    ...overrides,
  };
}

describe("modelsOf", () => {
  it("joins gemini-3.1-pro-preview and gemini-3-flash from the billed models", () => {
    const cost = {
      models: { "gemini-3.1-pro-preview": { in: 1 }, "gemini-3-flash": {} },
    };

    expect(modelsOf(cost, "fallback-model")).toBe(
      "gemini-3.1-pro-preview, gemini-3-flash",
    );
  });

  it("falls back to the configured model when the cost names no model", () => {
    expect(modelsOf({ models: {} }, "gemini-3.1-pro-preview")).toBe(
      "gemini-3.1-pro-preview",
    );
  });

  it("falls back to the configured model when the cost is null", () => {
    expect(modelsOf(null, "gemini-3.1-pro-preview")).toBe(
      "gemini-3.1-pro-preview",
    );
  });

  it("is undefined when the cost is a string and no model is configured", () => {
    expect(modelsOf("free")).toBeUndefined();
  });
});

describe("producingVisitOf", () => {
  it("picks the retry, not the failed first attempt", () => {
    const failed = visit({ id: "v-1", report: { outcome: "failed" } });
    const retry = visit({ id: "v-2", iteration: 2 });

    expect(producingVisitOf([failed, retry])?.id).toBe("v-2");
  });

  it("skips a station visit that has no agent settings", () => {
    const agent = visit({ id: "v-1" });
    const station = visit({ id: "v-9", agentSettings: null });

    expect(producingVisitOf([agent, station])?.id).toBe("v-1");
  });

  it("is undefined when every agent visit failed", () => {
    const failed = visit({ report: { outcome: "failed" } });

    expect(producingVisitOf([failed])).toBeUndefined();
  });
});
