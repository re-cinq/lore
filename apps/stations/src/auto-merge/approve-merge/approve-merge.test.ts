import { describe, expect, it } from "vitest";
import {
  APPROVAL_BODY,
  approveAndMerge,
  NEEDS_CODE_OWNER,
  NEEDS_REVIEWER,
  LOOP_OFF,
  type Approver,
  type MergeProject,
} from "./approve-merge.js";

const LORE = "lore-agent[bot]";

function scene(opts: {
  author?: string;
  requiredApprovals?: number;
  sensitive?: string[];
  state?: "open" | "closed" | "merged";
  autoMerge?: boolean;
  loopOn?: boolean;
  codeOwnersReview?: boolean;
}) {
  const steps: string[] = [];
  const project: MergeProject = {
    pulls: {
      get: async () => ({
        state: opts.state ?? "open",
        author: opts.author ?? "gedaiu",
        nodeId: "PR_7",
        baseBranch: "main",
        autoMerge: opts.autoMerge ?? false,
      }),
      getBranchRule: async () => ({
        requiredApprovals: opts.requiredApprovals ?? 1,
        codeOwnersReview: opts.codeOwnersReview ?? false,
      }),
      enableAutoMerge: async (nodeId, method) => {
        steps.push(`arm:${nodeId}:${method}`);
      },
      merge: async (number, method) => {
        steps.push(`merge:${number}:${method}`);
      },
    },
    codeOwners: async () =>
      (opts.sensitive ?? []).map((path) => ({
        path,
        owners: ["@acme/platform"],
      })),
    askCodeOwners: async (number, owned, ask) => {
      steps.push(`ask-owners:${number}:${owned.length}:${ask}`);
    },
    loopOn: async () => opts.loopOn ?? true,
    audit: {
      write: async (row) => {
        steps.push(`audit:${row.event_type}`);
      },
    },
  };
  const approver = (login?: string): Approver => ({
    login,
    approve: async (number, body) => {
      steps.push(`approve:${number}:${body === APPROVAL_BODY}`);
    },
  });

  return { project, approver, steps };
}

describe("approveAndMerge", () => {
  it("arms auto-merge with squash before approving a person's PR on a branch that requires an approval", async () => {
    const { project, approver, steps } = scene({ requiredApprovals: 1 });

    expect({
      step: await approveAndMerge(project, approver(LORE), 7),
      steps,
    }).toEqual({
      step: { outcome: "success", state: "armed" },
      steps: [
        "arm:PR_7:squash",
        "audit:auto_merge_armed",
        "approve:7:true",
        "audit:auto_merge_approved",
      ],
    });
  });

  it("does not arm again a PR already armed, and still approves it", async () => {
    const { project, approver, steps } = scene({ autoMerge: true });

    await approveAndMerge(project, approver(LORE), 7);

    expect(steps).toEqual(["approve:7:true", "audit:auto_merge_approved"]);
  });

  it("approves and squash-merges a PR on a branch with no approval rule", async () => {
    const { project, approver, steps } = scene({ requiredApprovals: 0 });

    expect({
      step: await approveAndMerge(project, approver(LORE), 7),
      steps,
    }).toEqual({
      step: { outcome: "success", state: "merged" },
      steps: ["approve:7:true", "merge:7:squash", "audit:auto_merge_merged"],
    });
  });

  it("parks a PR on an unprotected branch that changes a CODEOWNERS path, merging nothing and asking its code owners", async () => {
    const { project, approver, steps } = scene({
      requiredApprovals: 0,
      sensitive: [".github/workflows/ci.yml"],
    });

    expect({
      step: await approveAndMerge(project, approver(LORE), 7),
      steps,
    }).toEqual({
      step: { outcome: "failed", reason: NEEDS_CODE_OWNER },
      steps: ["ask-owners:7:1:approve and merge"],
    });
  });

  it("parks Lore's own PR when only Lore's App can approve, and approves it as lore-reviewer when that App is installed", async () => {
    const own = scene({ author: LORE });
    const reviewer = scene({ author: LORE });

    expect([
      await approveAndMerge(own.project, own.approver(LORE), 7),
      await approveAndMerge(reviewer.project, reviewer.approver(), 7),
    ]).toEqual([
      { outcome: "failed", reason: NEEDS_REVIEWER },
      { outcome: "success", state: "armed" },
    ]);
  });

  it("merges Lore's own PR on a branch with no approval rule without approving it, when only Lore's App is there", async () => {
    const { project, approver, steps } = scene({
      author: LORE,
      requiredApprovals: 0,
    });

    expect({
      step: await approveAndMerge(project, approver(LORE), 7),
      steps,
    }).toEqual({
      step: { outcome: "success", state: "merged" },
      steps: ["merge:7:squash", "audit:auto_merge_merged"],
    });
  });

  it("approves and merges nothing once the loop was switched off while the run waited", async () => {
    const { project, approver, steps } = scene({ loopOn: false });

    expect({
      step: await approveAndMerge(project, approver(LORE), 7),
      steps,
    }).toEqual({ step: { outcome: "failed", reason: LOOP_OFF }, steps: [] });
  });

  it("audits lore-reviewer's approval of Lore's own PR as lore_reviewer_approved, the row the merged-without-a-click KPI counts", async () => {
    const { project, approver, steps } = scene({ author: LORE });

    await approveAndMerge(project, approver(), 7);

    expect(steps).toContain("audit:lore_reviewer_approved");
  });

  it("answers success for a PR that merged meanwhile, and fails one that was closed", async () => {
    const merged = scene({ state: "merged" });
    const closed = scene({ state: "closed" });

    expect([
      await approveAndMerge(merged.project, merged.approver(LORE), 7),
      await approveAndMerge(closed.project, closed.approver(LORE), 7),
    ]).toEqual([
      { outcome: "success", state: "merged" },
      { outcome: "failed", reason: "the pull request is closed" },
    ]);
  });

  it("arms, approves and asks the code owners of a PR that changes an owned path on a branch whose rule wants a code owner's review, and asks nobody without one, since lore's approve step refused 17 times over the weekend of 2026-10-23", async () => {
    const owned = scene({
      codeOwnersReview: true,
      sensitive: ["infra/main.tf"],
    });
    const unowned = scene({ codeOwnersReview: true });

    await approveAndMerge(owned.project, owned.approver(LORE), 7);
    await approveAndMerge(unowned.project, unowned.approver(LORE), 7);

    expect([owned.steps.at(-1), unowned.steps.at(-1)]).toEqual([
      "ask-owners:7:1:approve",
      "audit:auto_merge_approved",
    ]);
  });
});
