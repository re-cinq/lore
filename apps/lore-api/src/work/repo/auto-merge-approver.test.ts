import { describe, it, expect } from "vitest";
import { InMemoryAudit } from "@re-cinq/lore-shared/project/audit/audit-memory.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  disarmLorePulls,
  missingPrerequisites,
  ruleGaps,
} from "./auto-merge-approver.js";

const protectedRule = {
  requiredApprovals: 1,
  codeOwnersReview: true,
  requiredChecks: ["build"],
};

const pull = (number: number, fields: Partial<PullRef>): PullRef => ({
  repo: "re-cinq/lore",
  number,
  title: `PR ${number}`,
  branch: `b${number}`,
  state: "open",
  labels: [],
  url: `https://github.com/re-cinq/lore/pull/${number}`,
  nodeId: `PR_${number}`,
  ...fields,
});

describe("ruleGaps", () => {
  it("returns nothing for one approval, Code Owners review and a build check", () => {
    expect(ruleGaps(protectedRule)).toEqual([]);
  });

  it("names all three gaps for an unprotected branch", () => {
    expect(
      ruleGaps({
        requiredApprovals: 0,
        codeOwnersReview: false,
        requiredChecks: [],
      }),
    ).toEqual([
      "ruleset requiring one approval",
      "review from Code Owners",
      "the required CI checks",
    ]);
  });
});

describe("missingPrerequisites", () => {
  it("reads the rule of the default branch develop", async () => {
    const branches: string[] = [];

    const missing = await missingPrerequisites({
      appInstalled: true,
      defaultBranch: async () => "develop",
      getBranchRule: async (branch) => {
        branches.push(branch);

        return protectedRule;
      },
    });

    expect({ missing, branches }).toEqual({
      missing: [],
      branches: ["develop"],
    });
  });

  it("names the installation and ruleset access when the App is absent and the rule read fails", async () => {
    const missing = await missingPrerequisites({
      appInstalled: false,
      defaultBranch: async () => "main",
      getBranchRule: async () => {
        throw new Error("403");
      },
    });

    expect(missing).toEqual([
      "App installation",
      "ruleset access on the default branch",
    ]);
  });
});

describe("disarmLorePulls", () => {
  const appLogin = "lore-agent[bot]";

  it("disarms only Lore's armed PR 1 and writes one audit row for it", async () => {
    const disarmed: string[] = [];
    const audit = new InMemoryAudit();

    const failed = await disarmLorePulls({
      appLogin,
      audit,
      pulls: {
        list: async () => [
          pull(1, { author: appLogin, autoMerge: true }),
          pull(2, { author: appLogin, autoMerge: false }),
          pull(3, { author: "gedaiu", autoMerge: true }),
        ],
        cancelAutoMerge: async (nodeId) => {
          disarmed.push(nodeId);
        },
      },
    });

    expect({ failed, disarmed, entries: audit.entries }).toEqual({
      failed: [],
      disarmed: ["PR_1"],
      entries: [
        { event_type: "auto_merge_disarmed", payload: { prNumber: 1 } },
      ],
    });
  });

  it("writes no audit row for PR 4 when GitHub refuses to disarm it", async () => {
    const audit = new InMemoryAudit();

    const failed = await disarmLorePulls({
      appLogin,
      audit,
      pulls: {
        list: async () => [pull(4, { author: appLogin, autoMerge: true })],
        cancelAutoMerge: async () => {
          throw new Error("GraphQL refused");
        },
      },
    });

    expect({ failed, entries: audit.entries }).toEqual({
      failed: [4],
      entries: [],
    });
  });

  it("disarms nothing when Lore runs without an App login", async () => {
    const disarmed: string[] = [];

    await disarmLorePulls({
      appLogin: undefined,
      audit: new InMemoryAudit(),
      pulls: {
        list: async () => [pull(5, { author: "", autoMerge: true })],
        cancelAutoMerge: async (nodeId) => {
          disarmed.push(nodeId);
        },
      },
    });

    expect(disarmed).toEqual([]);
  });
});
