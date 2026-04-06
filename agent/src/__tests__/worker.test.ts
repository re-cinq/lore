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

// ── Task priority filtering (mirrors pollOnce decision logic) ──────

describe("task priority filtering", () => {
  /**
   * Mirrors the pollOnce query logic: immediate tasks skip the grace
   * period, normal tasks need to be older than 30 seconds.
   */
  function shouldPickUp(task: { priority: string; ageSeconds: number; status: string }): boolean {
    if (task.status !== "pending") return false;
    if (task.priority === "immediate") return true;
    return task.ageSeconds >= 30;
  }

  it("picks up immediate tasks regardless of age", () => {
    expect(shouldPickUp({ priority: "immediate", ageSeconds: 0, status: "pending" })).toBe(true);
    expect(shouldPickUp({ priority: "immediate", ageSeconds: 5, status: "pending" })).toBe(true);
  });

  it("does NOT pick up normal tasks younger than 30 seconds", () => {
    expect(shouldPickUp({ priority: "normal", ageSeconds: 10, status: "pending" })).toBe(false);
    expect(shouldPickUp({ priority: "normal", ageSeconds: 29, status: "pending" })).toBe(false);
  });

  it("picks up normal tasks older than 30 seconds", () => {
    expect(shouldPickUp({ priority: "normal", ageSeconds: 30, status: "pending" })).toBe(true);
    expect(shouldPickUp({ priority: "normal", ageSeconds: 120, status: "pending" })).toBe(true);
  });

  it("skips running-local tasks", () => {
    expect(shouldPickUp({ priority: "immediate", ageSeconds: 0, status: "running-local" })).toBe(false);
  });

  it("skips non-pending tasks", () => {
    expect(shouldPickUp({ priority: "immediate", ageSeconds: 0, status: "running" })).toBe(false);
    expect(shouldPickUp({ priority: "immediate", ageSeconds: 0, status: "completed" })).toBe(false);
  });

  /**
   * When multiple tasks are eligible, immediate tasks should be
   * processed before normal ones (ORDER BY priority).
   */
  function sortByPriority(tasks: { priority: string; createdAt: number }[]): typeof tasks {
    return [...tasks].sort((a, b) => {
      const pa = a.priority === "immediate" ? 0 : 1;
      const pb = b.priority === "immediate" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return a.createdAt - b.createdAt;
    });
  }

  it("immediate tasks sort before normal tasks", () => {
    const tasks = [
      { priority: "normal", createdAt: 1 },
      { priority: "immediate", createdAt: 3 },
      { priority: "normal", createdAt: 2 },
    ];
    const sorted = sortByPriority(tasks);
    expect(sorted[0].priority).toBe("immediate");
  });

  it("within same priority, older tasks come first (FIFO)", () => {
    const tasks = [
      { priority: "normal", createdAt: 3 },
      { priority: "normal", createdAt: 1 },
      { priority: "normal", createdAt: 2 },
    ];
    const sorted = sortByPriority(tasks);
    expect(sorted.map(t => t.createdAt)).toEqual([1, 2, 3]);
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
