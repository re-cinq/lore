import { describe, it, expect } from "vitest";
import {
  approvalCount,
  approvers,
  deriveBlockedReason,
  type PullState,
} from "./derivation.js";

const CLEAR: PullState = {
  base: "main",
  mergeability: { mergeable: true, state: "clean" },
  rule: { requiredApprovals: 1, codeOwnersReview: false, requiredChecks: [] },
  checks: [],
  ci: "success",
  approvals: 1,
};

const run = (name: string, status = "completed") => ({
  name,
  status,
  conclusion: status === "completed" ? "success" : null,
});

describe("deriveBlockedReason", () => {
  it("answers null when the PR is clean, green and approved", () => {
    expect(deriveBlockedReason(CLEAR)).toBe(null);
  });

  it("answers merge_conflict on main when GitHub reports the PR unmergeable, ahead of every other reason", () => {
    expect(
      deriveBlockedReason({
        ...CLEAR,
        mergeability: { mergeable: false, state: "dirty" },
        ci: "pending",
        approvals: 0,
      }),
    ).toEqual({ reason: "merge_conflict", detail: "main" });
  });

  it("answers base_behind on main when the mergeable state is behind and CI is pending", () => {
    expect(
      deriveBlockedReason({
        ...CLEAR,
        mergeability: { mergeable: true, state: "behind" },
        ci: "pending",
      }),
    ).toEqual({ reason: "base_behind", detail: "main" });
  });

  it("answers required_check_missing for lint when the head has a build run but no lint run", () => {
    expect(
      deriveBlockedReason({
        ...CLEAR,
        rule: { ...CLEAR.rule, requiredChecks: ["build", "lint"] },
        checks: [run("build", "in_progress")],
      }),
    ).toEqual({ reason: "required_check_missing", detail: "lint" });
  });

  it("answers waiting_on_ci when the required build run is still in progress", () => {
    expect(
      deriveBlockedReason({
        ...CLEAR,
        rule: { ...CLEAR.rule, requiredChecks: ["build"] },
        checks: [run("build", "in_progress")],
      }),
    ).toEqual({ reason: "waiting_on_ci", detail: null });
  });

  it("answers waiting_on_ci when the head's CI is pending on a branch with no required checks", () => {
    expect(deriveBlockedReason({ ...CLEAR, ci: "pending" })).toEqual({
      reason: "waiting_on_ci",
      detail: null,
    });
  });

  it("answers needs_code_owner when the rule asks for a code owner and no approval is given", () => {
    expect(
      deriveBlockedReason({
        ...CLEAR,
        rule: { ...CLEAR.rule, codeOwnersReview: true },
        approvals: 0,
      }),
    ).toEqual({ reason: "needs_code_owner", detail: null });
  });

  it("answers needs_code_owner when an approval is given but GitHub still reports blocked under a code-owner rule", () => {
    expect(
      deriveBlockedReason({
        ...CLEAR,
        mergeability: { mergeable: true, state: "blocked" },
        rule: { ...CLEAR.rule, codeOwnersReview: true },
      }),
    ).toEqual({ reason: "needs_code_owner", detail: null });
  });

  it("answers needs_approval when 1 approval is required and 0 are given", () => {
    expect(deriveBlockedReason({ ...CLEAR, approvals: 0 })).toEqual({
      reason: "needs_approval",
      detail: null,
    });
  });
});

const review = (user: string, state: string) => ({
  id: 1,
  state,
  body: "",
  user,
  submitted_at: "2026-10-14T10:00:00Z",
});

describe("approvalCount", () => {
  it("counts 1 approval when alice approved and bob approved then requested changes", () => {
    expect(
      approvalCount([
        review("alice", "APPROVED"),
        review("bob", "APPROVED"),
        review("bob", "CHANGES_REQUESTED"),
        review("alice", "COMMENTED"),
      ]),
    ).toBe(1);
  });
});

describe("approvers", () => {
  it("names alice and the lore-reviewer App when bob's approval was dismissed and carol only commented", () => {
    expect(
      approvers([
        review("alice", "APPROVED"),
        review("bob", "APPROVED"),
        review("bob", "DISMISSED"),
        review("lore-reviewer[bot]", "APPROVED"),
        review("carol", "COMMENTED"),
      ]),
    ).toEqual(["alice", "lore-reviewer[bot]"]);
  });
});

describe("deriveBlockedReason on red CI", () => {
  it("answers waiting_on_ci naming build when the required build run failed", () => {
    expect(
      deriveBlockedReason({
        ...CLEAR,
        rule: { ...CLEAR.rule, requiredChecks: ["build"] },
        checks: [{ name: "build", status: "completed", conclusion: "failure" }],
        ci: "failure",
      }),
    ).toEqual({ reason: "waiting_on_ci", detail: "build" });
  });
});
