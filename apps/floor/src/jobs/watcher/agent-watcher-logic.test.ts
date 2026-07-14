import { describe, it, expect } from "vitest";
import type { Agent } from "@re-cinq/agent-contracts";
import {
  taskIdOf,
  taskTypeOf,
  parseReviewResult,
  decideCiGate,
  decideTokenReclaim,
  runOutcomeFromTaskStatus,
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
    expect(parseReviewResult("notes\nREVIEW_RESULT:APPROVED\n")).toBe(
      "approved",
    );
  });
  it("parses CHANGES_REQUESTED with trailing feedback", () => {
    expect(
      parseReviewResult("REVIEW_RESULT: CHANGES_REQUESTED: fix the thing"),
    ).toBe("changes_requested");
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
  // The tell is the ROUTING (task type has a builtin assembly line), not row
  // existence — single-CR tasks get assembly_lines rows too now, so a row no
  // longer distinguishes multi-node lines.
  it("reclaims a single-agent task's token on a terminal phase", () => {
    expect(
      decideTokenReclaim({ phase: "Succeeded", isAssemblyLineTask: false }),
    ).toBe(true);
    expect(
      decideTokenReclaim({ phase: "Failed", isAssemblyLineTask: false }),
    ).toBe(true);
  });
  it("skips a task routed to a multi-node assembly line (freed at line completion)", () => {
    expect(
      decideTokenReclaim({ phase: "Succeeded", isAssemblyLineTask: true }),
    ).toBe(false);
  });
  it("skips a non-terminal phase", () => {
    expect(
      decideTokenReclaim({ phase: "Running", isAssemblyLineTask: false }),
    ).toBe(false);
    expect(
      decideTokenReclaim({ phase: undefined, isAssemblyLineTask: false }),
    ).toBe(false);
  });
});

describe("runOutcomeFromTaskStatus", () => {
  it("maps pr-created and review to pr_created", () => {
    expect(runOutcomeFromTaskStatus("pr-created")).toBe("pr_created");
    expect(runOutcomeFromTaskStatus("review")).toBe("pr_created");
  });
  it("maps failed and needs-human-help to failed", () => {
    expect(runOutcomeFromTaskStatus("failed")).toBe("failed");
    expect(runOutcomeFromTaskStatus("needs-human-help")).toBe("failed");
  });
  it("maps completed to completed", () => {
    expect(runOutcomeFromTaskStatus("completed")).toBe("completed");
  });
});
