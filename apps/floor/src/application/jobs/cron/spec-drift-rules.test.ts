import { describe, it, expect } from "vitest";
import { isAssertionSource, shouldSkipDrift } from "./spec-drift-rules.js";

describe("isAssertionSource", () => {
  it("excludes research docs", () => {
    expect(isAssertionSource("specs/6-dark-factory/research.md")).toBe(false);
  });

  it("excludes plan docs", () => {
    expect(isAssertionSource("specs/6-dark-factory/plan.md")).toBe(false);
  });

  it("excludes tasks docs", () => {
    expect(isAssertionSource("specs/6-dark-factory/tasks.md")).toBe(false);
  });

  it("excludes quickstart docs", () => {
    expect(isAssertionSource("specs/6-dark-factory/quickstart.md")).toBe(false);
  });

  it("is case-insensitive about the excluded basename", () => {
    expect(isAssertionSource("specs/X/RESEARCH.md")).toBe(false);
  });

  it("includes spec docs", () => {
    expect(isAssertionSource("specs/6-dark-factory/spec.md")).toBe(true);
  });

  it("includes data-model docs", () => {
    expect(isAssertionSource("specs/6-dark-factory/data-model.md")).toBe(true);
  });

  it("matches on the basename, not a parent directory named research", () => {
    expect(isAssertionSource("research/spec.md")).toBe(true);
  });

  it("treats a trailing-slash path as a non-excluded source", () => {
    expect(isAssertionSource("specs/foo/")).toBe(true);
  });
});

describe("shouldSkipDrift", () => {
  const now = new Date("2026-06-01T10:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400_000).toISOString();

  it("creates a task when none exists", () => {
    expect(shouldSkipDrift([], now)).toBe(false);
  });

  it("skips when an open PR task already exists, regardless of age", () => {
    expect(shouldSkipDrift([{ status: "pr-created", created_at: daysAgo(100) }], now)).toBe(true);
  });

  it("skips when a task is awaiting review", () => {
    expect(shouldSkipDrift([{ status: "review", created_at: daysAgo(40) }], now)).toBe(true);
  });

  it("skips when a prior task failed", () => {
    expect(shouldSkipDrift([{ status: "failed", created_at: daysAgo(100) }], now)).toBe(true);
  });

  it("skips a recently merged task within the cooldown", () => {
    expect(shouldSkipDrift([{ status: "merged", created_at: daysAgo(2) }], now)).toBe(true);
  });

  it("allows refiling once a merged task is past the cooldown", () => {
    expect(shouldSkipDrift([{ status: "merged", created_at: daysAgo(100) }], now)).toBe(false);
  });

  it("allows refiling after an old cancelled task", () => {
    expect(shouldSkipDrift([{ status: "cancelled", created_at: daysAgo(100) }], now)).toBe(false);
  });
});
