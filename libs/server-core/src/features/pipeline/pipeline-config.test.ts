import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  loadTaskTypes,
  getTaskTypeConfig,
  getTaskTypes,
  getDefaultRepo,
  buildPrompt,
  getTaskTypeConfigForRepo,
} from "./pipeline-config.js";
import { join } from "node:path";

describe("loadTaskTypes", () => {
  afterEach(() => {
    delete process.env.TASK_TYPES_PATH;
  });

  it("loads task types from the project's YAML file", () => {
    const yamlPath = join(
      import.meta.dirname,
      "..",
      "..",
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

  it("handles missing YAML gracefully — getTaskTypes returns whatever was loaded before, and the call does not throw", () => {
    process.env.TASK_TYPES_PATH = "/nonexistent/path/task-types.yaml";
    const origCwd = process.cwd;

    process.cwd = () => "/nonexistent";
    const origHome = process.env.HOME;

    process.env.HOME = "/nonexistent";
    const origCtx = process.env.CONTEXT_PATH;

    process.env.CONTEXT_PATH = "/nonexistent";

    loadTaskTypes();

    process.cwd = origCwd;
    process.env.HOME = origHome;
    process.env.CONTEXT_PATH = origCtx;
  });
});

describe("getTaskTypeConfig", () => {
  beforeAll(() => {
    const yamlPath = join(
      import.meta.dirname,
      "..",
      "..",
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

  it("each claude-code task type has a prompt_template", () => {
    for (const type of getTaskTypes()) {
      const cfg = getTaskTypeConfig(type);

      expect(cfg, `${type} should have config`).not.toBeNull();

      if (cfg!.execution_mode === "graph-ingest") {
        continue;
      }
      expect(
        cfg!.prompt_template,
        `${type} should have prompt_template`,
      ).toBeTruthy();
    }
  });
});

describe("buildPrompt", () => {
  beforeAll(() => {
    const yamlPath = join(
      import.meta.dirname,
      "..",
      "..",
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
    expect(result).toContain("Complete the following task:");
  });

  it("preserves template structure around the description", () => {
    const result = buildPrompt("implementation", "Add caching layer");

    expect(result).toContain("Add caching layer");
    expect(result).toContain("specification");
  });

  it("handles empty description", () => {
    const result = buildPrompt("general", "");

    expect(result).not.toContain("{description}");
  });

  it("handles description with special characters", () => {
    const desc = 'Fix the "quotes" & <brackets> issue $100';
    const result = buildPrompt("general", desc);

    expect(result).toContain(desc);
  });
});

describe("getDefaultRepo", () => {
  beforeAll(() => {
    const yamlPath = join(
      import.meta.dirname,
      "..",
      "..",
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

describe("getTaskTypeConfigForRepo", () => {
  beforeAll(() => {
    const yamlPath = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "scripts",
      "task-types.yaml",
    );

    process.env.TASK_TYPES_PATH = yamlPath;
    loadTaskTypes();
  });

  it("returns base config unchanged when repoSettings is null", () => {
    const cfg = getTaskTypeConfigForRepo("general", null);
    const base = getTaskTypeConfig("general")!;

    expect(cfg.prompt_template).toBe(base.prompt_template);
    expect(cfg.timeout_minutes).toBe(base.timeout_minutes);
  });

  it("returns default base config for an unknown type with no repoSettings", () => {
    const cfg = getTaskTypeConfigForRepo("nonexistent-type", undefined);

    expect(cfg).toEqual({
      prompt_template: "Complete the following task: {description}",
      timeout_minutes: 30,
      review_required: false,
    });
  });

  it("applies a per-type override field on top of the base config", () => {
    const cfg = getTaskTypeConfigForRepo("general", {
      task_overrides: { general: { timeout_minutes: 99 } },
    });

    expect(cfg.timeout_minutes).toBe(99);
  });

  it("uses the override prompt_template when the repo sets one", () => {
    const cfg = getTaskTypeConfigForRepo("general", {
      task_overrides: {
        general: { prompt_template: "Custom: {description}" },
      },
    });

    expect(cfg.prompt_template).toBe("Custom: {description}");
  });

  it("keeps the base prompt_template when overrides omit it", () => {
    const base = getTaskTypeConfig("general")!;
    const cfg = getTaskTypeConfigForRepo("general", {
      task_overrides: { general: { timeout_minutes: 5 } },
    });

    expect(cfg.prompt_template).toBe(base.prompt_template);
  });
});
