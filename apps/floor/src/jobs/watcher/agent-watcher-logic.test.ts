import { describe, it, expect } from "vitest";
import type { Agent } from "@re-cinq/agent-contracts";
import {
  taskIdOf,
  taskTypeOf,
  parseReviewResult,
  decideCiGate,
  decideTokenReclaim,
  runOutcomeFromTaskStatus,
  decideFeatureLink,
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
  it("maps an un-advanced task on a Failed CR to failed, not completed", () => {
    // Failed phase + no failureReason → handleFailure never ran → task still
    // running; the row must not close as completed.
    expect(runOutcomeFromTaskStatus("running", "Failed")).toBe("failed");
    expect(runOutcomeFromTaskStatus("queued", "Failed")).toBe("failed");
  });
  it("maps an un-advanced task on a Succeeded CR to completed", () => {
    expect(runOutcomeFromTaskStatus("running", "Succeeded")).toBe("completed");
  });
});

describe("decideFeatureLink", () => {
  const bundle = { feature_id: "f1", slug: "spec-standard" };

  it("links the PR for the merged line, whose task type is feature-planning", async () => {
    // The whole feature — rounds, spec analysis, write, push — runs under ONE
    // feature-planning task now (FR6.26). Keying the link on `feature-finalize` meant
    // the push opened a spec PR and nothing flipped the feature to pr-open, so the
    // wizard sat on "Creating the spec PR…" forever while the work had actually run.
    expect(decideFeatureLink("feature-planning", bundle)).toEqual({
      featureId: "f1",
      slug: "spec-standard",
    });
  });

  it("links nothing for a task that is not part of a feature's life", () => {
    expect(decideFeatureLink("implementation", bundle)).toBeNull();
  });

  it("links nothing when the task carries no feature", () => {
    expect(decideFeatureLink("feature-planning", { slug: "x" })).toBeNull();
  });

  it("tolerates a missing slug, which the merged line's task does not carry", () => {
    // The finalize endpoint used to put the slug on its own task. The merged line's
    // task predates the spec, so the path is simply omitted rather than invented.
    expect(decideFeatureLink("feature-planning", { feature_id: "f1" })).toEqual(
      {
        featureId: "f1",
        slug: undefined,
      },
    );
  });
});

// Imported here, not at the top: three spec files anchor #Lxx links into the
// it() lines above, so nothing may shift them (#1294).
import { taskPageUrl } from "./agent-watcher-logic.js";

describe("taskPageUrl", () => {
  it("builds https://lore.example.com/tasks/t-1 from the UI base URL", () => {
    expect(taskPageUrl("t-1", "https://lore.example.com")).toEqual(
      "https://lore.example.com/tasks/t-1",
    );
  });

  it("strips trailing slashes so https://lore.example.com/// still yields a clean path", () => {
    expect(taskPageUrl("t-1", "https://lore.example.com///")).toEqual(
      "https://lore.example.com/tasks/t-1",
    );
  });

  it("returns undefined when LORE_UI_URL is unset", () => {
    expect(taskPageUrl("t-1", undefined)).toBeUndefined();
  });

  it("returns undefined when LORE_UI_URL is empty", () => {
    expect(taskPageUrl("t-1", "")).toBeUndefined();
  });
});
