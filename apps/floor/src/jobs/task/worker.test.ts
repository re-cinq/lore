import { describe, it, expect, vi } from "vitest";
import { recoverStaleTasks, isFeatureLifecycleType } from "./worker.js";
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
  }

 if (taskType === "feature-request") {
    return "handleFeatureRequest";
  }

 return "handleClaudeCodeTask";
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

// ── Claim ordering / grace ──────────────────────────────────────────
// pollOnce's claim semantics (immediate-first, 30s grace, status filter,
// FIFO) now live in the shared TaskQueue and are covered for real by
// libs/shared/src/project/tasks/task-queue.test.ts — no mirror here.

// ── Stale task recovery ─────────────────────────────────────────────

describe("recoverStaleTasks", () => {
  const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);
  const OLD = new Date(NOW - 31 * 60_000).toISOString();

  it("recovers every stale task with no open line, implementation included", async () => {
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
      hasOpenLine: async () => false,
    });

    // `implementation` used to be skipped here, citing the LoreTask CRD watcher
    // that ADR-031 deleted. The open-line check below is what actually protects a
    // line-backed task, so the type carve-out only stranded an implementation
    // task whose line had already died — running forever, swept every tick.
    expect(recovered).toBe(4);
    expect(setStatus.mock.calls.map((c) => c[0])).toEqual([
      "task-1",
      "task-2",
      "task-3",
      "task-4",
    ]);
    expect(setStatus).toHaveBeenCalledWith("task-2", "pending");
    expect(insertEvent).toHaveBeenCalledWith("task-4", "running", "pending", {
      reason: "crash-recovery",
    });
  });
});

describe("recoverStaleTasks and a line that is legitimately idle", () => {
  const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);
  const OLD = new Date(NOW - 31 * 60_000).toISOString();

  const staleQueue = () =>
    new InMemoryTaskQueue(
      [
        {
          id: "task-1",
          status: "running",
          task_type: "feature-planning",
          updated_at: OLD,
        },
      ],
      () => NOW,
    );

  it("leaves a task alone while its assembly line is still open", async () => {
    // A merged planning line parks on the author for as long as the person takes, and
    // its owning task stays `running` for the feature's whole life. The sweep read
    // that as a crashed task and re-dispatched it on EVERY Floor boot — a fresh
    // planning agent, and a bill, per restart.
    const setStatus = vi.fn();

    const recovered = await recoverStaleTasks({
      queue: staleQueue(),
      setStatus,
      insertEvent: vi.fn(),
      hasOpenLine: async () => true,
    });

    expect({ recovered, calls: setStatus.mock.calls }).toEqual({
      recovered: 0,
      calls: [],
    });
  });

  it("still recovers a stale task whose line has finished or never existed", async () => {
    // The guard must not swallow the real case: a task with no live line behind it is
    // exactly what crash recovery is for.
    const setStatus = vi.fn();

    const recovered = await recoverStaleTasks({
      queue: staleQueue(),
      setStatus,
      insertEvent: vi.fn(),
      hasOpenLine: async () => false,
    });

    expect(recovered).toBe(1);
    expect(setStatus).toHaveBeenCalledWith("task-1", "pending");
  });
});

describe("isFeatureLifecycleType", () => {
  it("covers planning and decompose", () => {
    // One decision, two consumers: which task types run their own assembly line, and
    // which must NOT open a per-task Issue. decompose was missing from both when its
    // in-process handler was retired, so it would have run without a line and opened
    // an Issue the decompose line then duplicated per story.
    expect(
      ["feature-planning", "feature-decompose"].map(isFeatureLifecycleType),
    ).toEqual([true, true]);
  });

  it("excludes the task types that do open their own issue", () => {
    expect(
      ["implementation", "review", "spec-task", "feature-finalize"].map(
        isFeatureLifecycleType,
      ),
    ).toEqual([false, false, false, false]);
  });
});
