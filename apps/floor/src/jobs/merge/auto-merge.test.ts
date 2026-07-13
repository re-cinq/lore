import { describe, it, expect } from "vitest";
import {
  evaluateAutoMerge,
  type AutoMergePolicyInputs,
  type DarkFactoryAutoMerge,
} from "./auto-merge.js";

const DEFAULT_AUTO_MERGE: DarkFactoryAutoMerge = {
  paths: ["specs/**", "adrs/**", "*.md", "CLAUDE.md", ".claude/**"],
  min_trust: "docs",
  require_green_ci: true,
  require_bot_approval: true,
};

function inputs(
  overrides: Partial<AutoMergePolicyInputs> = {},
): AutoMergePolicyInputs {
  return {
    darkFactoryEnabled: true,
    autoMerge: DEFAULT_AUTO_MERGE,
    trustLevel: "docs",
    changedPaths: ["specs/foo.md"],
    ciSucceeded: true,
    botApproved: true,
    humanChangesRequested: false,
    ...overrides,
  };
}

describe("evaluateAutoMerge — happy path", () => {
  it("merges when all gates pass", () => {
    const d = evaluateAutoMerge(inputs());

    expect(d.outcome).toBe("merged");
    expect(d.rule.path_match_count).toBe(1);
  });
});

describe("evaluateAutoMerge — deferral reasons (priority)", () => {
  it("deferred:dark_mode_off when not enabled (overrides everything)", () => {
    expect(
      evaluateAutoMerge(inputs({ darkFactoryEnabled: false })).outcome,
    ).toBe("deferred:dark_mode_off");
  });

  it("deferred:no_changes for an empty PR before path-allowlist check", () => {
    expect(evaluateAutoMerge(inputs({ changedPaths: [] })).outcome).toBe(
      "deferred:no_changes",
    );
  });

  it("deferred:human_review when human changes requested", () => {
    expect(
      evaluateAutoMerge(inputs({ humanChangesRequested: true })).outcome,
    ).toBe("deferred:human_review");
  });

  it("deferred:ci_failed when require_green_ci and CI red", () => {
    expect(evaluateAutoMerge(inputs({ ciSucceeded: false })).outcome).toBe(
      "deferred:ci_failed",
    );
  });

  it("ci_failed gate skipped when require_green_ci is false", () => {
    expect(
      evaluateAutoMerge(
        inputs({
          ciSucceeded: false,
          autoMerge: { ...DEFAULT_AUTO_MERGE, require_green_ci: false },
        }),
      ).outcome,
    ).toBe("merged");
  });

  it("deferred:bot_changes_requested when bot did not APPROVE", () => {
    expect(evaluateAutoMerge(inputs({ botApproved: false })).outcome).toBe(
      "deferred:bot_changes_requested",
    );
  });

  it("deferred:path_outside_allowlist on mixed PR", () => {
    expect(
      evaluateAutoMerge(
        inputs({ changedPaths: ["specs/foo.md", "agent/src/foo.ts"] }),
      ).outcome,
    ).toBe("deferred:path_outside_allowlist");
  });

  it("deferred:trust_too_low when repo trust < min_trust", () => {
    expect(
      evaluateAutoMerge(
        inputs({
          trustLevel: "docs",
          autoMerge: { ...DEFAULT_AUTO_MERGE, min_trust: "implementation" },
        }),
      ).outcome,
    ).toBe("deferred:trust_too_low");
  });

  it("deferred:trust_too_low when repo has no trust set", () => {
    expect(evaluateAutoMerge(inputs({ trustLevel: undefined })).outcome).toBe(
      "deferred:trust_too_low",
    );
  });

  it("merges when trust exceeds the min", () => {
    expect(
      evaluateAutoMerge(
        inputs({
          trustLevel: "full",
          autoMerge: { ...DEFAULT_AUTO_MERGE, min_trust: "docs" },
        }),
      ).outcome,
    ).toBe("merged");
  });
});

describe("evaluateAutoMerge — rule trace", () => {
  it("captures all decision inputs in the audit-log payload", () => {
    const d = evaluateAutoMerge(
      inputs({
        changedPaths: ["specs/a.md", "*.md", "agent/src/x.ts"],
      }),
    );

    expect(d.rule.path_match_count).toBe(2); // specs/a.md and *.md (literal); the .ts misses
    expect(d.rule.trust_level).toBe("docs");
    expect(d.rule.ci_status).toBe("success");
    expect(d.rule.bot_review_state).toBe("APPROVED");
  });

  it("reports CI status as failed when CI red", () => {
    const d = evaluateAutoMerge(inputs({ ciSucceeded: false }));

    expect(d.rule.ci_status).toBe("failed");
  });

  it("reports bot review as CHANGES_REQUESTED when not approved", () => {
    const d = evaluateAutoMerge(inputs({ botApproved: false }));

    expect(d.rule.bot_review_state).toBe("CHANGES_REQUESTED");
  });
});
