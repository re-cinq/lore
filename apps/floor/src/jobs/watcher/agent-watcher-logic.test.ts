import { describe, it, expect } from "vitest";
import type { Agent } from "@re-cinq/agent-contracts";
import {
  taskIdOf,
  taskTypeOf,
  parseReviewResult,
  decideCiGate,
  decideTokenReclaim,
} from "./agent-watcher-logic.js";

describe("taskIdOf / taskTypeOf", () => {
  it("reads the labels AgentCrBackend sets", () => {
    const agent: Agent = {
      metadata: {
        labels: {
          "lore.re-cinq.com/task-id": "t1",
          "lore.re-cinq.com/task-type": "implementation",
        },
      },
    };
    expect(taskIdOf(agent)).toBe("t1");
    expect(taskTypeOf(agent)).toBe("implementation");
  });
  it("returns undefined when the labels are absent", () => {
    expect(taskIdOf({})).toBeUndefined();
    expect(taskTypeOf({})).toBeUndefined();
  });
});

describe("parseReviewResult", () => {
  it("parses APPROVED", () => {
    expect(parseReviewResult("notes\nREVIEW_RESULT:APPROVED\n")).toBe("approved");
  });
  it("parses CHANGES_REQUESTED with trailing feedback", () => {
    expect(parseReviewResult("REVIEW_RESULT: CHANGES_REQUESTED: fix the thing")).toBe(
      "changes_requested",
    );
  });
  it("returns undefined when there is no marker or no output", () => {
    expect(parseReviewResult("looks fine")).toBeUndefined();
    expect(parseReviewResult(undefined)).toBeUndefined();
  });
});

describe("decideCiGate", () => {
  it("defers on a red or still-running CI", () => {
    expect(decideCiGate("failure")).toBe("defer");
    expect(decideCiGate("pending")).toBe("defer");
  });
  it("proceeds on green, or when no CI is configured", () => {
    expect(decideCiGate("success")).toBe("proceed");
    expect(decideCiGate("none")).toBe("proceed");
  });
});

describe("decideTokenReclaim", () => {
  it("reclaims a single-agent task's token on a terminal phase", () => {
    expect(decideTokenReclaim({ phase: "Succeeded", hasAssemblyLine: false })).toBe(true);
    expect(decideTokenReclaim({ phase: "Failed", hasAssemblyLine: false })).toBe(true);
  });
  it("skips a task backed by a multi-node assembly line (freed at line completion)", () => {
    expect(decideTokenReclaim({ phase: "Succeeded", hasAssemblyLine: true })).toBe(false);
  });
  it("skips a non-terminal phase", () => {
    expect(decideTokenReclaim({ phase: "Running", hasAssemblyLine: false })).toBe(false);
    expect(decideTokenReclaim({ phase: undefined, hasAssemblyLine: false })).toBe(false);
  });
});

