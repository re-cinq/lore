import { describe, it, expect, vi } from "vitest";
import { recoverStaleTasks } from "./worker.js";
import { slugify } from "./task-helpers.js";
import { InMemoryTaskQueue } from "@re-cinq/lore-shared/project/tasks/task-queue-memory.js";

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Add Health Check Endpoint")).toBe(
      "add-health-check-endpoint",
    );
  });

  it("removes special characters", () => {
    expect(slugify("fix: auth (JWT) bug!")).toBe("fix-auth-jwt-bug");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("---hello---")).toBe("hello");
  });

  it("truncates to 30 characters", () => {
    const long =
      "this is a very long description that exceeds thirty characters";
    expect(slugify(long).length).toBeLessThanOrEqual(30);
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("collapses multiple non-alphanumeric chars into one hyphen", () => {
    expect(slugify("hello   ///   world")).toBe("hello-world");
  });

  it("does not leave a trailing hyphen when the 30-char cut lands on a dash", () => {
    // 29 'a's, then a word boundary: the dash falls at index 29, inside the cut.
    const slug = slugify(`${"a".repeat(29)} tail`);
    expect(slug).toBe("a".repeat(29));
    expect(slug.endsWith("-")).toBe(false);
  });
});

// ── Task routing logic (mirrors processTask decision tree) ──────────

/**
 * Pure function that mirrors the routing decision in worker.ts processTask().
 * Returns which handler would be called for a given task type.
 */
function routeTask(
  taskType: string,
): "handleOnboard" | "handleFeatureRequest" | "handleClaudeCodeTask" {
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

// ── Claim ordering / grace ──────────────────────────────────────────
// pollOnce's claim semantics (immediate-first, 30s grace, status filter,
// FIFO) now live in the shared TaskQueue and are covered for real by
// libs/shared/src/project/tasks/task-queue.test.ts — no mirror here.

// ── Stale task recovery ─────────────────────────────────────────────

describe("recoverStaleTasks", () => {
  const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);
  const OLD = new Date(NOW - 31 * 60_000).toISOString();

  it("recovers stale non-implementation tasks and skips CRD-managed implementation tasks", async () => {
    const queue = new InMemoryTaskQueue(
      [
        {
          id: "task-1",
          status: "running",
          task_type: "implementation",
          updated_at: OLD,
        },
        {
          id: "task-2",
          status: "running",
          task_type: "general",
          updated_at: OLD,
        },
        {
          id: "task-3",
          status: "queued",
          task_type: "implementation",
          updated_at: OLD,
        },
        {
          id: "task-4",
          status: "running",
          task_type: "onboard",
          updated_at: OLD,
        },
      ],
      () => NOW,
    );
    const setStatus = vi.fn();
    const insertEvent = vi.fn();

    const recovered = await recoverStaleTasks({
      queue,
      setStatus,
      insertEvent,
    });

    expect(recovered).toBe(2);
    expect(setStatus.mock.calls.map((c) => c[0])).toEqual(["task-2", "task-4"]);
    expect(setStatus).toHaveBeenCalledWith("task-2", "pending");
    expect(insertEvent).toHaveBeenCalledWith("task-4", "running", "pending", {
      reason: "crash-recovery",
    });
  });
});
