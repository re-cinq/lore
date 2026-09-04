import { describe, it, expect } from "vitest";
import { decompositionRows, planningTimeoutOf } from "./page-input";
import type { AgentDefinition } from "@/lib/agents-mirror";
import type { DecompTaskRow } from "@/lib/decomposition-view";

const taskRow = (over: Partial<DecompTaskRow> = {}): DecompTaskRow => ({
  description: "Implement the thing",
  status: "in_progress",
  context_bundle: null,
  ...over,
});

const agent = (over: Partial<AgentDefinition> = {}): AgentDefinition =>
  ({
    name: "implementation",
    model: null,
    timeout_minutes: null,
    prompt: null,
    image: null,
    execution_mode: "agent",
    review_required: false,
    project_id: null,
    config: null,
    ...over,
  }) as AgentDefinition;

describe("decompositionRows", () => {
  it("returns the decomposition's task rows when the read succeeded", () => {
    const rows = [taskRow()];

    expect(decompositionRows({ status: "ok", data: { tasks: rows } })).toEqual(
      rows,
    );
  });

  it("returns an empty list when the read failed", () => {
    expect(decompositionRows({ status: "error" })).toEqual([]);
  });
});

describe("planningTimeoutOf", () => {
  it("returns the feature-planning agent's configured timeout", () => {
    const agents = [
      agent({ name: "implementation", timeout_minutes: 30 }),
      agent({ name: "feature-planning", timeout_minutes: 45 }),
    ];

    expect(planningTimeoutOf(agents)).toBe(45);
  });

  it("defaults to 15 minutes when no feature-planning agent is configured", () => {
    expect(planningTimeoutOf([agent({ name: "implementation" })])).toBe(15);
  });

  it("defaults to 15 minutes when the feature-planning agent has no timeout", () => {
    expect(
      planningTimeoutOf([
        agent({ name: "feature-planning", timeout_minutes: null }),
      ]),
    ).toBe(15);
  });
});
