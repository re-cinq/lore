import { describe, it, expect } from "vitest";
import {
  evaluateAutoMerge,
  type AutoMergePolicyInputs,
  type DarkFactoryAutoMerge,
} from "./auto-merge.js";

const DEFAULT_AUTO_MERGE: DarkFactoryAutoMerge = {
  enabled: true,
  paths: ["specs/**", "adrs/**", "*.md"],
  escalate_paths: [],
  min_trust: "docs",
  require_green_ci: true,
  require_bot_approval: true,
};

function inputs(
  overrides: Partial<AutoMergePolicyInputs> = {},
): AutoMergePolicyInputs {
  return {
    autoMerge: DEFAULT_AUTO_MERGE,
    trustLevel: "docs",
    changedPaths: ["specs/foo.md"],
    ciSucceeded: true,
    botApproved: true,
    humanChangesRequested: false,
    reviewInFlight: false,
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
  it("deferred:auto_merge_off when auto-merge is off (overrides everything)", () => {
    expect(
      evaluateAutoMerge(
        inputs({ autoMerge: { ...DEFAULT_AUTO_MERGE, enabled: false } }),
      ).outcome,
    ).toBe("deferred:auto_merge_off");
  });

  it("deferred:no_changes for an empty PR before path-allowlist check", () => {
    expect(evaluateAutoMerge(inputs({ changedPaths: [] })).outcome).toBe(
      "deferred:no_changes",
    );
  });

  it("deferred:review_in_flight while a code-review line is open", () => {
    expect(evaluateAutoMerge(inputs({ reviewInFlight: true })).outcome).toBe(
      "deferred:review_in_flight",
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
  it("captures all decision inputs in the audit-log payload, counting only literal path matches (specs/a.md and *.md, not agent/src/x.ts)", () => {
    const d = evaluateAutoMerge(
      inputs({
        changedPaths: ["specs/a.md", "*.md", "agent/src/x.ts"],
      }),
    );

    expect(d.rule.path_match_count).toBe(2);
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

describe("evaluateAutoMerge — escalate paths", () => {
  const ESCALATING: DarkFactoryAutoMerge = {
    ...DEFAULT_AUTO_MERGE,
    paths: ["apps/**"],
    escalate_paths: ["apps/api/src/server.ts"],
  };

  it("defers apps/api/src/server.ts as a sensitive path although apps/** admits it", () => {
    const d = evaluateAutoMerge(
      inputs({
        autoMerge: ESCALATING,
        changedPaths: ["apps/api/src/server.ts", "apps/web/src/App.tsx"],
      }),
    );

    expect(d).toMatchObject({
      outcome: "deferred:sensitive_path",
      rule: { escalated_paths: ["apps/api/src/server.ts"] },
    });
  });

  it("defers CLAUDE.md as a sensitive path when the repo lists no escalate paths", () => {
    expect(
      evaluateAutoMerge(inputs({ changedPaths: ["CLAUDE.md"] })),
    ).toMatchObject({
      outcome: "deferred:sensitive_path",
      rule: { escalated_paths: ["CLAUDE.md"] },
    });
  });

  it("defers a red-CI PR touching an escalate path as sensitive_path, not ci_failed", () => {
    expect(
      evaluateAutoMerge(
        inputs({
          autoMerge: ESCALATING,
          changedPaths: ["apps/api/src/server.ts"],
          ciSucceeded: false,
        }),
      ).outcome,
    ).toBe("deferred:sensitive_path");
  });

  it("defers as review_in_flight while a review is open, ahead of sensitive_path", () => {
    expect(
      evaluateAutoMerge(
        inputs({
          autoMerge: ESCALATING,
          changedPaths: ["apps/api/src/server.ts"],
          reviewInFlight: true,
        }),
      ).outcome,
    ).toBe("deferred:review_in_flight");
  });

  it("records an empty escalated_paths list on a merge", () => {
    expect(evaluateAutoMerge(inputs()).rule.escalated_paths).toEqual([]);
  });
});
