import { describe, it, expect } from "vitest";
import {
  unwrapOr,
  normalizeConsoleTasks,
  normalizeConsoleDecisions,
  resolveTrustLevel,
  darkFactorySettingsOf,
} from "./page-input";

describe("unwrapOr", () => {
  it("returns the data when the result status is ok", () => {
    expect(unwrapOr({ status: "ok", data: [1, 2] }, [])).toEqual([1, 2]);
  });

  it("returns the fallback when the result status is not ok", () => {
    expect(unwrapOr({ status: "error" }, [])).toEqual([]);
  });
});

describe("normalizeConsoleTasks", () => {
  it("stringifies the id and passes the rest through", () => {
    const tasks = normalizeConsoleTasks([
      {
        id: 42,
        task_type: "implementation",
        status: "completed",
        pr_url: "https://gh/pr/1",
        created_at: "2026-06-11T10:00:00.000Z",
      },
    ]);

    expect(tasks).toEqual([
      {
        id: "42",
        task_type: "implementation",
        status: "completed",
        pr_url: "https://gh/pr/1",
        created_at: "2026-06-11T10:00:00.000Z",
      },
    ]);
  });
});

describe("normalizeConsoleDecisions", () => {
  it("defaults a missing payload to an empty object", () => {
    const decisions = normalizeConsoleDecisions([
      {
        event_type: "auto_merge_decision",
        payload: undefined,
        created_at: "2026-06-11T10:00:00.000Z",
      },
    ]);

    expect(decisions).toEqual([
      {
        event_type: "auto_merge_decision",
        payload: {},
        created_at: "2026-06-11T10:00:00.000Z",
      },
    ]);
  });

  it("passes an existing payload through unchanged", () => {
    const decisions = normalizeConsoleDecisions([
      {
        event_type: "auto_merge_decision",
        payload: { outcome: "merged" },
        created_at: "2026-06-11T10:00:00.000Z",
      },
    ]);

    expect(decisions[0]?.payload).toEqual({ outcome: "merged" });
  });
});

describe("resolveTrustLevel", () => {
  it("returns the configured trust level", () => {
    expect(resolveTrustLevel({ trust: { level: "full" } })).toBe("full");
  });

  it("returns unset when no trust level is configured", () => {
    expect(resolveTrustLevel({})).toBe("unset");
  });
});

describe("darkFactorySettingsOf", () => {
  it("returns the dark_factory settings block", () => {
    expect(darkFactorySettingsOf({ dark_factory: { enabled: true } })).toEqual({
      enabled: true,
    });
  });

  it("returns undefined when no dark_factory block is configured", () => {
    expect(darkFactorySettingsOf({})).toBeUndefined();
  });
});
