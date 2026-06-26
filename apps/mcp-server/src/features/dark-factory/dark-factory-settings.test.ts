import { describe, it, expect } from "vitest";
import {
  parseDarkFactorySettings,
  parseTaskOverrides,
  resolveSettings,
  twoKeyFieldsTouched,
  trustMeets,
} from "./dark-factory-settings.js";

describe("parseDarkFactorySettings", () => {
  it("accepts an empty patch", () => {
    expect(parseDarkFactorySettings({})).toEqual({});
  });

  it("accepts a complete settings doc", () => {
    const doc = {
      enabled: true,
      create_issue: "on_gate",
      auto_merge: {
        paths: ["specs/**"],
        min_trust: "docs",
        require_green_ci: true,
        require_bot_approval: true,
      },
      review: "trust_based",
      notify: ["escalation"],
    };
    expect(parseDarkFactorySettings(doc)).toEqual(doc);
  });

  it("rejects unknown create_issue values", () => {
    expect(() =>
      parseDarkFactorySettings({ create_issue: "sometimes" }),
    ).toThrow();
  });

  it("rejects unknown trust levels", () => {
    expect(() =>
      parseDarkFactorySettings({ auto_merge: { min_trust: "godmode" } }),
    ).toThrow();
  });

  it("rejects more than 32 paths", () => {
    expect(() =>
      parseDarkFactorySettings({
        auto_merge: { paths: Array.from({ length: 33 }, (_, i) => `p${i}`) },
      }),
    ).toThrow();
  });

  it("accepts an execution image", () => {
    expect(
      parseDarkFactorySettings({ execution: { image: "golang:1.23" } }),
    ).toEqual({ execution: { image: "golang:1.23" } });
  });

  it("rejects an empty execution image", () => {
    expect(() =>
      parseDarkFactorySettings({ execution: { image: "" } }),
    ).toThrow();
  });

  it("accepts an execution backend opt-in", () => {
    expect(
      parseDarkFactorySettings({ execution: { backend: "agent-cr" } }),
    ).toEqual({ execution: { backend: "agent-cr" } });
  });

  it("rejects an unknown execution backend", () => {
    expect(() =>
      parseDarkFactorySettings({ execution: { backend: "skynet" } }),
    ).toThrow();
  });
});

describe("resolveSettings", () => {
  it("applies opt-out defaults when partial is null", () => {
    const r = resolveSettings(null);
    expect(r.enabled).toBe(false);
    expect(r.create_issue).toBe("always");
    expect(r.review).toBe("always");
    expect(r.notify).toEqual(["all"]);
  });

  it("applies dark-mode defaults when enabled: true with no other fields", () => {
    const r = resolveSettings({ enabled: true });
    expect(r.create_issue).toBe("on_gate");
    expect(r.review).toBe("trust_based");
    // Empty notify list — escalations always fire via decideNotify
    // regardless, so listing them explicitly was redundant.
    expect(r.notify).toEqual([]);
    expect(r.auto_merge.paths).toContain("CLAUDE.md");
  });

  it("respects partial overrides", () => {
    const r = resolveSettings({
      enabled: true,
      create_issue: "always",
      auto_merge: { paths: ["only-this/**"] },
    });
    expect(r.create_issue).toBe("always");
    expect(r.auto_merge.paths).toEqual(["only-this/**"]);
    // Other auto_merge sub-fields fall back to defaults
    expect(r.auto_merge.min_trust).toBe("docs");
    expect(r.auto_merge.require_green_ci).toBe(true);
  });
});

describe("twoKeyFieldsTouched", () => {
  it("flags enabled toggle", () => {
    expect(twoKeyFieldsTouched({ enabled: true })).toEqual(["enabled"]);
    expect(twoKeyFieldsTouched({ enabled: false })).toEqual(["enabled"]);
  });

  it("flags auto_merge.paths", () => {
    expect(
      twoKeyFieldsTouched({ auto_merge: { paths: ["a", "b"] } }),
    ).toEqual(["auto_merge.paths"]);
  });

  it("flags require_green_ci only when downgrading to false", () => {
    expect(
      twoKeyFieldsTouched({ auto_merge: { require_green_ci: false } }),
    ).toEqual(["auto_merge.require_green_ci"]);
    expect(
      twoKeyFieldsTouched({ auto_merge: { require_green_ci: true } }),
    ).toEqual([]);
  });

  it("flags require_bot_approval only when downgrading to false", () => {
    expect(
      twoKeyFieldsTouched({ auto_merge: { require_bot_approval: false } }),
    ).toEqual(["auto_merge.require_bot_approval"]);
    expect(
      twoKeyFieldsTouched({ auto_merge: { require_bot_approval: true } }),
    ).toEqual([]);
  });

  it("returns empty for non-privileged fields", () => {
    expect(
      twoKeyFieldsTouched({
        create_issue: "never",
        review: "never",
        notify: ["all"],
      }),
    ).toEqual([]);
  });

  it("flags multiple fields in one patch", () => {
    expect(
      twoKeyFieldsTouched({
        enabled: true,
        auto_merge: { paths: ["x"], require_green_ci: false },
      }).sort(),
    ).toEqual(
      ["auto_merge.paths", "auto_merge.require_green_ci", "enabled"].sort(),
    );
  });

  it("flags execution.image (security boundary)", () => {
    expect(twoKeyFieldsTouched({ execution: { image: "golang:1.23" } })).toEqual(
      ["execution.image"],
    );
  });

  it("flags a per-task-type task_overrides execution.image", () => {
    expect(
      twoKeyFieldsTouched(
        {},
        { implementation: { execution: { image: "golang:1.23" } } },
      ),
    ).toEqual(["task_overrides.implementation.execution.image"]);
  });

  it("does not flag non-execution task_overrides fields", () => {
    expect(
      twoKeyFieldsTouched(
        {},
        { implementation: { model: "claude-x", timeout_minutes: 45 } },
      ),
    ).toEqual([]);
  });
});

describe("parseTaskOverrides", () => {
  it("accepts per-task-type model, timeout, suffix, review_required, execution.image", () => {
    const doc = {
      implementation: {
        model: "claude-opus-4-8",
        timeout_minutes: 45,
        system_prompt_suffix: "be terse",
        review_required: true,
        execution: { image: "golang:1.23" },
      },
    };
    expect(parseTaskOverrides(doc)).toEqual(doc);
  });

  it("rejects an empty per-task-type execution image", () => {
    expect(() =>
      parseTaskOverrides({ implementation: { execution: { image: "" } } }),
    ).toThrow();
  });
});

describe("trustMeets", () => {
  it("strict ordering", () => {
    expect(trustMeets("docs", "docs")).toBe(true);
    expect(trustMeets("tests", "docs")).toBe(true);
    expect(trustMeets("implementation", "tests")).toBe(true);
    expect(trustMeets("full", "implementation")).toBe(true);
    expect(trustMeets("docs", "tests")).toBe(false);
    expect(trustMeets("tests", "implementation")).toBe(false);
  });

  it("returns false when actual is undefined", () => {
    expect(trustMeets(undefined, "docs")).toBe(false);
  });
});
