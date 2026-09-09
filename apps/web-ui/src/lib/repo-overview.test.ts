import { describe, it, expect } from "vitest";
import {
  enrollmentFromRepo,
  isoTimestamp,
  needsWebhookSecret,
  overviewSettings,
} from "./repo-overview";

describe("isoTimestamp", () => {
  it("returns the ISO string for a pg Date", () => {
    expect(isoTimestamp(new Date("2026-09-04T10:30:00Z"))).toBe(
      "2026-09-04T10:30:00.000Z",
    );
  });

  it("returns null for null, undefined and an empty string", () => {
    expect([
      isoTimestamp(null),
      isoTimestamp(undefined),
      isoTimestamp(""),
    ]).toEqual([null, null, null]);
  });
});

describe("enrollmentFromRepo", () => {
  it("reads onboarded true with normalized timestamps from a full record", () => {
    expect(
      enrollmentFromRepo({
        onboarded_at: new Date("2026-01-02T00:00:00Z"),
        onboarding_pr_merged: true,
        onboarding_pr_url: "https://github.com/re-cinq/lore/pull/1",
        last_ingested_at: "2026-03-04T05:06:07Z",
        team: "platform",
      }),
    ).toEqual({
      onboarded: true,
      onboardedAt: "2026-01-02T00:00:00.000Z",
      onboardingPrMerged: true,
      onboardingPrUrl: "https://github.com/re-cinq/lore/pull/1",
      lastIngestedAt: "2026-03-04T05:06:07.000Z",
      team: "platform",
    });
  });

  it("returns onboarded false for a repo with no record", () => {
    expect(enrollmentFromRepo(null)).toEqual({
      onboarded: false,
      onboardedAt: null,
      onboardingPrMerged: false,
      onboardingPrUrl: null,
      lastIngestedAt: null,
      team: null,
    });
  });

  it("reads onboardingPrMerged false when the column is null", () => {
    expect(
      enrollmentFromRepo({ onboarding_pr_merged: null }).onboardingPrMerged,
    ).toBe(false);
  });
});

describe("needsWebhookSecret", () => {
  it("returns false for a configured hook", () => {
    expect(needsWebhookSecret({ state: "configured" })).toBe(false);
  });

  it("returns true for a missing and for a wrong_url hook", () => {
    expect([
      needsWebhookSecret({ state: "missing" }),
      needsWebhookSecret({ state: "wrong_url" }),
    ]).toEqual([true, true]);
  });

  it("returns false when the hook status could not be read", () => {
    expect(needsWebhookSecret(null)).toBe(false);
  });
});

describe("overviewSettings", () => {
  it("reads enabled true and the trust level from the settings JSONB", () => {
    expect(
      overviewSettings({
        dark_factory: { enabled: true },
        trust: { level: "implementation" },
      }),
    ).toEqual({ darkFactoryEnabled: true, trustLevel: "implementation" });
  });

  it("reads unset trust and dark factory off from empty settings", () => {
    expect(overviewSettings(null)).toEqual({
      darkFactoryEnabled: false,
      trustLevel: "unset",
    });
  });
});
