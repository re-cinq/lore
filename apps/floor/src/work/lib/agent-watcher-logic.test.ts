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
  stampPrOnOpenRuns,
  agentTerminalReport,
  stationOutcomeForRunOutcome,
  dispatchFacts,
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
  it("maps an un-advanced task on a Failed CR with no failureReason (handleFailure never ran) to failed, not completed", () => {
    expect(runOutcomeFromTaskStatus("running", "Failed")).toBe("failed");
    expect(runOutcomeFromTaskStatus("queued", "Failed")).toBe("failed");
  });
  it("maps an un-advanced task on a Succeeded CR to completed", () => {
    expect(runOutcomeFromTaskStatus("running", "Succeeded")).toBe("completed");
  });
});

describe("decideFeatureLink", () => {
  const bundle = { feature_id: "f1", slug: "spec-standard" };

  it("links the PR for the merged line (task type feature-planning, not feature-finalize, per FR6.26)", async () => {
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

  it("tolerates a missing slug, which the merged line's task predates and does not carry", () => {
    expect(decideFeatureLink("feature-planning", { feature_id: "f1" })).toEqual(
      {
        featureId: "f1",
        slug: undefined,
      },
    );
  });
});

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

describe("stampPrOnOpenRuns", () => {
  const runs = [
    { id: "run-1", status: "running" },
    { id: "run-2", status: "completed" },
    { id: "run-3", status: "queued" },
  ];

  it("merges pr_url and pr_number onto every open run of the task", async () => {
    const patched: Array<{ id: string; patch: Record<string, unknown> }> = [];

    await stampPrOnOpenRuns(
      {
        listForTask: async () => runs,
        mergeArgs: async (id, patch) => {
          patched.push({ id, patch });
        },
      },
      "task-9",
      { url: "https://gh/pr/12", number: 12 },
    );

    expect(patched).toEqual([
      { id: "run-1", patch: { pr_url: "https://gh/pr/12", pr_number: 12 } },
      { id: "run-3", patch: { pr_url: "https://gh/pr/12", pr_number: 12 } },
    ]);
  });

  it("does nothing when the task has no open run", async () => {
    const patched: string[] = [];

    await stampPrOnOpenRuns(
      {
        listForTask: async () => [{ id: "run-1", status: "completed" }],
        mergeArgs: async (id) => {
          patched.push(id);
        },
      },
      "task-9",
      { url: "https://gh/pr/12", number: 12 },
    );

    expect(patched).toEqual([]);
  });
});

describe("a review output that names both verdict markers", () => {
  it("reads CHANGES_REQUESTED when the agent quotes APPROVED first, since parseReviewVerdict checks CHANGES_REQUESTED before APPROVED", () => {
    const output = [
      "I was told to print REVIEW_RESULT:APPROVED or REVIEW_RESULT:CHANGES_REQUESTED.",
      "REVIEW_RESULT:CHANGES_REQUESTED: the base branch is wrong",
    ].join("\n");

    expect(parseReviewResult(output)).toBe("changes_requested");
  });
});

describe("agentTerminalReport", () => {
  it("reads the taskId, phase and status the kubernetes.agent.* event carries", () => {
    expect(
      agentTerminalReport({
        taskId: "t-1",
        agentName: "agent-11111111",
        phase: "Succeeded",
        status: {
          phase: "Succeeded",
          output: "done",
          failureReason: undefined,
        },
      }),
    ).toEqual({
      taskId: "t-1",
      agentName: "agent-11111111",
      phase: "Succeeded",
      output: "done",
      failureReason: undefined,
    });
  });

  it("returns null for an event carrying no task id, so nothing is processed blind", () => {
    expect(agentTerminalReport({ phase: "Succeeded" })).toBeNull();
  });

  it("returns null for a non-terminal phase rather than settling a live run", () => {
    expect(agentTerminalReport({ taskId: "t-1", phase: "Running" })).toBeNull();
  });

  it("tolerates a hand-inserted or replayed event carrying no status block, settling rather than throwing", () => {
    expect(agentTerminalReport({ taskId: "t-1", phase: "Succeeded" })).toEqual({
      taskId: "t-1",
      agentName: null,
      phase: "Succeeded",
      output: undefined,
      failureReason: undefined,
    });
  });

  it("reads a failure reason off a Failed report", () => {
    expect(
      agentTerminalReport({
        taskId: "t-1",
        phase: "Failed",
        status: { failureReason: "BackoffLimitExceeded" },
      }),
    ).toMatchObject({ phase: "Failed", failureReason: "BackoffLimitExceeded" });
  });
});

describe("stationOutcomeForRunOutcome", () => {
  it("translates the run outcome (pr_created/completed/error) into the station's StageOutcome vocabulary", () => {
    expect(stationOutcomeForRunOutcome("pr_created")).toBe("success");
    expect(stationOutcomeForRunOutcome("completed")).toBe("success");
    expect(stationOutcomeForRunOutcome("failed")).toBe("failed");
    expect(stationOutcomeForRunOutcome("error")).toBe("failed");
  });
});

describe("dispatchFacts", () => {
  const run = {
    blueprintName: "runbook",
    repo: "o/r",
    branch: "lore/runbook/x",
    args: { description: "write it" },
  };

  it("reads what the run row recorded at dispatch, not what a cluster still holds", () => {
    expect(dispatchFacts(run, null)).toEqual({
      taskType: "runbook",
      targetRepo: "o/r",
      branch: "lore/runbook/x",
      description: "write it",
    });
  });

  it("tolerates a run row with no branch and no description recorded, since a null reaching a PR body is a crash", () => {
    expect(
      dispatchFacts(
        { blueprintName: "runbook", repo: "o/r", branch: null, args: {} },
        null,
      ),
    ).toEqual({
      taskType: "runbook",
      targetRepo: "o/r",
      branch: "",
      description: "",
    });
  });

  it("falls back to the task row when no run row exists, so a CR dispatched before run rows covered single-CR tasks still settles", () => {
    expect(
      dispatchFacts(null, {
        task_type: "onboard",
        target_repo: "o/r2",
        target_branch: "lore/onboard/y",
        description: "onboard it",
        context_bundle: null,
      }),
    ).toEqual({
      taskType: "onboard",
      targetRepo: "o/r2",
      branch: "lore/onboard/y",
      description: "onboard it",
    });
  });

  it("prefers the task's context_bundle branch, which is the one dispatch used", () => {
    expect(
      dispatchFacts(null, {
        task_type: "onboard",
        target_repo: "o/r2",
        target_branch: null,
        description: "d",
        context_bundle: { branch: "existing/branch" },
      })?.branch,
    ).toBe("existing/branch");
  });

  it("yields an empty branch when the task names none either way, since target_branch is only written once a PR exists", () => {
    expect(
      dispatchFacts(null, {
        task_type: "onboard",
        target_repo: "o/r2",
        target_branch: null,
        description: "d",
        context_bundle: null,
      })?.branch,
    ).toBe("");
  });

  it("returns null when neither row exists, so nothing is settled from guesses", () => {
    expect(dispatchFacts(null, null)).toBeNull();
  });
});
