import { describe, it, expect } from "vitest";
import {
  AGENT_INSTRUCTION_PATHS,
  DEFAULT_AUTO_MERGE_PATHS,
  resolveDarkFactorySettings,
  resolveExecutionImage,
  DEFAULT_EXECUTION_IMAGE,
} from "./dark-factory-settings.js";

describe("resolveExecutionImage", () => {
  it("returns the default image when no execution settings are present", () => {
    expect(resolveExecutionImage({}, "implementation")).toBe(
      DEFAULT_EXECUTION_IMAGE,
    );
  });

  it("returns the default image when settings is null", () => {
    expect(resolveExecutionImage(null, "implementation")).toBe(
      DEFAULT_EXECUTION_IMAGE,
    );
  });

  it("returns the per-repo image from dark_factory.execution.image", () => {
    const settings = { dark_factory: { execution: { image: "golang:1.23" } } };

    expect(resolveExecutionImage(settings, "implementation")).toBe(
      "golang:1.23",
    );
  });

  it("returns the per-task-type image over the per-repo image", () => {
    const settings = {
      dark_factory: { execution: { image: "golang:1.23" } },
      task_overrides: {
        implementation: { execution: { image: "golang:1.23-toolchain" } },
      },
    };

    expect(resolveExecutionImage(settings, "implementation")).toBe(
      "golang:1.23-toolchain",
    );
  });

  it("applies a per-task-type image only to its own task type", () => {
    const settings = {
      dark_factory: { execution: { image: "golang:1.23" } },
      task_overrides: {
        implementation: { execution: { image: "golang:1.23-toolchain" } },
      },
    };

    expect(resolveExecutionImage(settings, "gap-fill")).toBe("golang:1.23");
  });
});

describe("resolveDarkFactorySettings auto_merge switch and escalate list", () => {
  it("resolves auto-merge off with no escalate paths when the repo sets neither", () => {
    expect(resolveDarkFactorySettings({}).auto_merge).toMatchObject({
      enabled: false,
      escalate_paths: [],
    });
  });

  it("resolves auto-merge on when dark mode is on and auto_merge.enabled is unset", () => {
    expect(
      resolveDarkFactorySettings({ enabled: true }).auto_merge.enabled,
    ).toBe(true);
  });

  it("resolves auto-merge on without dark mode when auto_merge.enabled is true", () => {
    const resolved = resolveDarkFactorySettings({
      auto_merge: { enabled: true, escalate_paths: ["infra/**"] },
    });

    expect(resolved).toMatchObject({
      enabled: false,
      auto_merge: { enabled: true, escalate_paths: ["infra/**"] },
    });
  });

  it("resolves auto-merge off in dark mode when auto_merge.enabled is false", () => {
    expect(
      resolveDarkFactorySettings({
        enabled: true,
        auto_merge: { enabled: false },
      }).auto_merge.enabled,
    ).toBe(false);
  });

  it("keeps CLAUDE.md and .claude/** out of the default allowlist", () => {
    expect(DEFAULT_AUTO_MERGE_PATHS).toEqual(["specs/**", "adrs/**", "*.md"]);
  });

  it("escalates CLAUDE.md, AGENTS.md, GEMINI.md, .claude and .gemini at any depth", () => {
    expect(AGENT_INSTRUCTION_PATHS).toEqual([
      "**/CLAUDE.md",
      "**/AGENTS.md",
      "**/GEMINI.md",
      "**/.claude/**",
      "**/.gemini/**",
    ]);
  });
});
