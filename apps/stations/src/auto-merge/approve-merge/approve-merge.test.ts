import { describe, expect, it } from "vitest";
import {
  APPROVAL_BODY,
  approveAndMerge,
  NEEDS_CODE_OWNER,
  NEEDS_REVIEWER,
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
      }),
      enableAutoMerge: async (nodeId, method) => {
        steps.push(`arm:${nodeId}:${method}`);
      },
      merge: async (number, method) => {
        steps.push(`merge:${number}:${method}`);
      },
    },
    sensitivePaths: async () => opts.sensitive ?? [],
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

  it("parks a PR on an unprotected branch that changes a CODEOWNERS path, merging nothing", async () => {
    const { project, approver, steps } = scene({
      requiredApprovals: 0,
      sensitive: [".github/workflows/ci.yml"],
    });

    expect({
      step: await approveAndMerge(project, approver(LORE), 7),
      steps,
    }).toEqual({
      step: { outcome: "failed", reason: NEEDS_CODE_OWNER },
      steps: [],
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
});
