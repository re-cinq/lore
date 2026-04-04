import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import {
  loadTaskTypes,
  getTaskTypeConfig,
  getTaskTypes,
  getDefaultRepo,
  buildPrompt,
} from "../pipeline-config.js";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// loadTaskTypes — point TASK_TYPES_PATH at the real scripts/task-types.yaml
// ---------------------------------------------------------------------------

describe("loadTaskTypes", () => {
  afterEach(() => {
    delete process.env.TASK_TYPES_PATH;
  });

  it("loads task types from the project's YAML file", () => {
    // Point directly at the repo's task-types.yaml
    const yamlPath = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "scripts",
      "task-types.yaml",
    );
    process.env.TASK_TYPES_PATH = yamlPath;
    loadTaskTypes();

    const types = getTaskTypes();
    expect(types.length).toBeGreaterThan(0);
    expect(types).toContain("general");
    expect(types).toContain("implementation");
    expect(types).toContain("review");
    expect(types).toContain("onboard");
    expect(types).toContain("feature-request");
  });

  it("handles missing YAML gracefully (empty config)", () => {
    process.env.TASK_TYPES_PATH = "/nonexistent/path/task-types.yaml";
    // Override cwd-based paths too
    const origCwd = process.cwd;
    process.cwd = () => "/nonexistent";
    const origHome = process.env.HOME;
    process.env.HOME = "/nonexistent";
    const origCtx = process.env.CONTEXT_PATH;
    process.env.CONTEXT_PATH = "/nonexistent";

    loadTaskTypes();

    // Restore
    process.cwd = origCwd;
    process.env.HOME = origHome;
    process.env.CONTEXT_PATH = origCtx;

    // After failed load, getTaskTypes returns whatever was loaded before.
    // This test verifies it doesn't throw.
  });
});

// ---------------------------------------------------------------------------
// getTaskTypeConfig — requires loadTaskTypes to have been called
// ---------------------------------------------------------------------------

describe("getTaskTypeConfig", () => {
  beforeAll(() => {
    const yamlPath = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "scripts",
      "task-types.yaml",
    );
    process.env.TASK_TYPES_PATH = yamlPath;
    loadTaskTypes();
  });

  it("returns config for a known task type", () => {
    const cfg = getTaskTypeConfig("general");
    expect(cfg).not.toBeNull();
    expect(cfg!.prompt_template).toBeTruthy();
    expect(cfg!.timeout_minutes).toBeGreaterThan(0);
    expect(typeof cfg!.review_required).toBe("boolean");
  });

  it("returns null for unknown task type", () => {
    expect(getTaskTypeConfig("nonexistent-type")).toBeNull();
  });

  it("implementation type has claude-code execution mode", () => {
    const cfg = getTaskTypeConfig("implementation") as any;
    expect(cfg).not.toBeNull();
    expect(cfg.execution_mode).toBe("claude-code");
  });

  it("review type has timeout configured", () => {
    const cfg = getTaskTypeConfig("review");
    expect(cfg).not.toBeNull();
    expect(cfg!.timeout_minutes).toBeGreaterThan(0);
  });

  it("each task type has a prompt_template", () => {
    for (const type of getTaskTypes()) {
      const cfg = getTaskTypeConfig(type);
      expect(cfg, `${type} should have config`).not.toBeNull();
      expect(cfg!.prompt_template, `${type} should have prompt_template`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// buildPrompt — template substitution
// ---------------------------------------------------------------------------

describe("buildPrompt", () => {
  beforeAll(() => {
    const yamlPath = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "scripts",
      "task-types.yaml",
    );
    process.env.TASK_TYPES_PATH = yamlPath;
    loadTaskTypes();
  });

  it("substitutes {description} in the template", () => {
    const result = buildPrompt("general", "Fix the login bug");
    expect(result).toContain("Fix the login bug");
    expect(result).not.toContain("{description}");
  });

  it("falls back to default template for unknown type", () => {
    const result = buildPrompt("unknown-type", "Do something");
    expect(result).toContain("Do something");
    // The fallback template is "Complete the following task: {description}"
    expect(result).toContain("Complete the following task:");
  });

  it("preserves template structure around the description", () => {
    const result = buildPrompt("implementation", "Add caching layer");
    expect(result).toContain("Add caching layer");
    // Implementation template mentions specs and rules
    expect(result).toContain("specification");
  });

  it("handles empty description", () => {
    const result = buildPrompt("general", "");
    // Should not throw, just produce the template with empty description
    expect(result).not.toContain("{description}");
  });

  it("handles description with special characters", () => {
    const desc = 'Fix the "quotes" & <brackets> issue $100';
    const result = buildPrompt("general", desc);
    expect(result).toContain(desc);
  });
});

// ---------------------------------------------------------------------------
// getDefaultRepo
// ---------------------------------------------------------------------------

describe("getDefaultRepo", () => {
  beforeAll(() => {
    const yamlPath = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "scripts",
      "task-types.yaml",
    );
    process.env.TASK_TYPES_PATH = yamlPath;
    loadTaskTypes();
  });

  it("returns configured default repo for types that have one", () => {
    const repo = getDefaultRepo("general");
    expect(repo).toBe("re-cinq/lore");
  });

  it("falls back to re-cinq/lore for unknown types", () => {
    expect(getDefaultRepo("nonexistent")).toBe("re-cinq/lore");
  });
});
