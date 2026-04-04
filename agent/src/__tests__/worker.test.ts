import { describe, it, expect, vi, beforeEach } from "vitest";

// ── slugify (copied from worker.ts — private function) ──────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Add Health Check Endpoint")).toBe("add-health-check-endpoint");
  });

  it("removes special characters", () => {
    expect(slugify("fix: auth (JWT) bug!")).toBe("fix-auth-jwt-bug");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("---hello---")).toBe("hello");
  });

  it("truncates to 30 characters", () => {
    const long = "this is a very long description that exceeds thirty characters";
    expect(slugify(long).length).toBeLessThanOrEqual(30);
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("collapses multiple non-alphanumeric chars into one hyphen", () => {
    expect(slugify("hello   ///   world")).toBe("hello-world");
  });
});

// ── Task routing logic (mirrors processTask decision tree) ──────────

/**
 * Pure function that mirrors the routing decision in worker.ts processTask().
 * Returns which handler would be called for a given task type.
 */
function routeTask(taskType: string): "handleOnboard" | "handleFeatureRequest" | "handleClaudeCodeTask" {
  if (taskType === "onboard") {
    return "handleOnboard";
  } else if (taskType === "feature-request") {
    return "handleFeatureRequest";
  } else {
    return "handleClaudeCodeTask";
  }
}

describe("task routing", () => {
  it("routes onboard tasks to handleOnboard", () => {
    expect(routeTask("onboard")).toBe("handleOnboard");
  });

  it("routes feature-request tasks to handleFeatureRequest", () => {
    expect(routeTask("feature-request")).toBe("handleFeatureRequest");
  });

  it("routes implementation tasks to handleClaudeCodeTask", () => {
    expect(routeTask("implementation")).toBe("handleClaudeCodeTask");
  });

  it("routes review tasks to handleClaudeCodeTask", () => {
    expect(routeTask("review")).toBe("handleClaudeCodeTask");
  });

  it("routes general tasks to handleClaudeCodeTask", () => {
    expect(routeTask("general")).toBe("handleClaudeCodeTask");
  });

  it("routes runbook tasks to handleClaudeCodeTask", () => {
    expect(routeTask("runbook")).toBe("handleClaudeCodeTask");
  });

  it("routes gap-fill tasks to handleClaudeCodeTask", () => {
    expect(routeTask("gap-fill")).toBe("handleClaudeCodeTask");
  });

  it("routes unknown task types to handleClaudeCodeTask", () => {
    expect(routeTask("some-new-type")).toBe("handleClaudeCodeTask");
  });
});

// ── buildPrompt (from config.ts) ────────────────────────────────────

describe("buildPrompt", () => {
  // Re-implement buildPrompt with a controllable map (same logic as config.ts)
  function buildPrompt(
    taskType: string,
    description: string,
    taskTypes: Map<string, { prompt_template: string }>,
  ): string {
    const cfg = taskTypes.get(taskType) ?? taskTypes.get("general");
    const template =
      cfg?.prompt_template ?? "Complete the following task: {description}";
    return template.replace("{description}", description);
  }

  it("uses the matching task type template", () => {
    const types = new Map([
      ["implementation", { prompt_template: "Implement: {description}" }],
    ]);
    expect(buildPrompt("implementation", "add health check", types)).toBe(
      "Implement: add health check",
    );
  });

  it("falls back to general template when type is missing", () => {
    const types = new Map([
      ["general", { prompt_template: "General task: {description}" }],
    ]);
    expect(buildPrompt("unknown-type", "do something", types)).toBe(
      "General task: do something",
    );
  });

  it("falls back to hardcoded default when both type and general are missing", () => {
    const types = new Map<string, { prompt_template: string }>();
    expect(buildPrompt("anything", "my task", types)).toBe(
      "Complete the following task: my task",
    );
  });

  it("replaces {description} placeholder in template", () => {
    const types = new Map([
      ["review", { prompt_template: "Review this PR: {description}" }],
    ]);
    expect(buildPrompt("review", "PR #42 on re-cinq/lore", types)).toBe(
      "Review this PR: PR #42 on re-cinq/lore",
    );
  });
});

// ── issueRef (mirrors worker.ts) ────────────────────────────────────

function issueRef(issueNumber: number | null): string {
  return issueNumber ? `\n\nRefs #${issueNumber}` : "";
}

describe("issueRef", () => {
  it("returns issue reference for a valid number", () => {
    expect(issueRef(42)).toBe("\n\nRefs #42");
  });

  it("returns empty string for null", () => {
    expect(issueRef(null)).toBe("");
  });
});

// ── Stale task recovery logic ───────────────────────────────────────

describe("recoverStaleTasks (logic)", () => {
  it("skips implementation tasks (managed by LoreTask CRD)", () => {
    const staleTasks = [
      { id: "task-1", task_type: "implementation" },
      { id: "task-2", task_type: "general" },
      { id: "task-3", task_type: "implementation" },
      { id: "task-4", task_type: "onboard" },
    ];

    // Same filter logic as recoverStaleTasks
    const toRecover = staleTasks.filter(
      (t) => t.task_type !== "implementation",
    );

    expect(toRecover).toHaveLength(2);
    expect(toRecover.map((t) => t.id)).toEqual(["task-2", "task-4"]);
  });
});
