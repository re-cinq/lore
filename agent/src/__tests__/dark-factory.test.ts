import { describe, it, expect } from "vitest";
import {
  decideIssueCreate,
  decideReviewMode,
  type DarkFactoryRepoSettings,
} from "../lib/dark-factory.js";

describe("decideIssueCreate", () => {
  const opt: DarkFactoryRepoSettings = { enabled: true };

  it("with_issue:true forces creation regardless of policy", () => {
    expect(
      decideIssueCreate({
        approvalNeeded: false,
        overrides: { with_issue: true },
        settings: { enabled: true, create_issue: "never" },
      }),
    ).toEqual({ create: true, reason: "with_issue_override" });
  });

  it("approval_required wins over with_issue:false", () => {
    expect(
      decideIssueCreate({
        approvalNeeded: true,
        overrides: { with_issue: false },
        settings: { enabled: true, create_issue: "never" },
      }).reason,
    ).toBe("approval_required_overrides_dark_mode");
  });

  it("dark mode off → default_create", () => {
    expect(
      decideIssueCreate({
        approvalNeeded: false,
        overrides: undefined,
        settings: { enabled: false },
      }),
    ).toEqual({ create: true, reason: "default_create" });
  });

  it("dark mode off with no settings at all → default_create", () => {
    expect(
      decideIssueCreate({
        approvalNeeded: false,
        overrides: undefined,
        settings: undefined,
      }),
    ).toEqual({ create: true, reason: "default_create" });
  });

  it("dark mode on, create_issue:never (and no approval) → suppressed", () => {
    expect(
      decideIssueCreate({
        approvalNeeded: false,
        overrides: undefined,
        settings: { ...opt, create_issue: "never" },
      }),
    ).toEqual({ create: false, reason: "create_issue_never" });
  });

  it("dark mode on, create_issue:always → forced", () => {
    expect(
      decideIssueCreate({
        approvalNeeded: false,
        overrides: undefined,
        settings: { ...opt, create_issue: "always" },
      }),
    ).toEqual({ create: true, reason: "create_issue_always" });
  });

  it("dark mode on, default policy on_gate, no approval → suppressed", () => {
    expect(
      decideIssueCreate({
        approvalNeeded: false,
        overrides: undefined,
        settings: { ...opt }, // create_issue defaults to on_gate
      }),
    ).toEqual({
      create: false,
      reason: "create_issue_on_gate_no_approval",
    });
  });
});

describe("decideReviewMode (T034)", () => {
  it("per-task human_review:required → always (overrides repo)", () => {
    expect(
      decideReviewMode({
        overrides: { human_review: "required" },
        settings: { enabled: true, review: "never" },
      }),
    ).toBe("always");
  });

  it("dark mode off → always (legacy behavior)", () => {
    expect(
      decideReviewMode({
        overrides: undefined,
        settings: { enabled: false },
      }),
    ).toBe("always");
  });

  it("no settings at all → always", () => {
    expect(
      decideReviewMode({
        overrides: undefined,
        settings: undefined,
      }),
    ).toBe("always");
  });

  it("dark mode on, no review setting → defaults to trust_based", () => {
    expect(
      decideReviewMode({
        overrides: undefined,
        settings: { enabled: true },
      }),
    ).toBe("trust_based");
  });

  it("dark mode on with review:never → never", () => {
    expect(
      decideReviewMode({
        overrides: undefined,
        settings: { enabled: true, review: "never" },
      }),
    ).toBe("never");
  });

  it("dark mode on with review:always → always", () => {
    expect(
      decideReviewMode({
        overrides: undefined,
        settings: { enabled: true, review: "always" },
      }),
    ).toBe("always");
  });

  it("dark mode on with review:trust_based → trust_based (the canonical dark-mode default)", () => {
    expect(
      decideReviewMode({
        overrides: undefined,
        settings: { enabled: true, review: "trust_based" },
      }),
    ).toBe("trust_based");
  });
});
