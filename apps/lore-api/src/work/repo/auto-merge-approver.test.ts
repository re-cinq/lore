import { describe, it, expect } from "vitest";
import { InMemoryAudit } from "@re-cinq/lore-shared/project/audit/audit-memory.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { disarmLorePulls } from "./auto-merge-approver.js";

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

describe("disarmLorePulls", () => {
  const appLogin = "lore-agent[bot]";

  it("disarms only Lore's armed PR 1 and writes one audit row for it", async () => {
    const disarmed: string[] = [];
    const audit = new InMemoryAudit();

    const failed = await disarmLorePulls({
      appLogin,
      audit,
      loopPulls: new Set(),
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
      loopPulls: new Set(),
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
      loopPulls: new Set(),
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

  it("disarms a person's armed PR 6 the loop worked, and leaves their PR 7 the loop never touched", async () => {
    const disarmed: string[] = [];

    await disarmLorePulls({
      appLogin,
      audit: new InMemoryAudit(),
      loopPulls: new Set([6]),
      pulls: {
        list: async () => [
          pull(6, { author: "gedaiu", autoMerge: true }),
          pull(7, { author: "gedaiu", autoMerge: true }),
        ],
        cancelAutoMerge: async (nodeId) => {
          disarmed.push(nodeId);
        },
      },
    });

    expect(disarmed).toEqual(["PR_6"]);
  });
});
