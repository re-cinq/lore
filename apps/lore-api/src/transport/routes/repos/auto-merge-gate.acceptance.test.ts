import { describe, it, expect, vi } from "vitest";
import { disarmAutoMerge } from "./auto-merge-gate.js";
import {
  floorClient,
  type RunView,
} from "@re-cinq/lore-shared/floor/floor-client.js";

vi.mock("@re-cinq/lore-shared/floor/floor-client.js", () => {
  const listMock = vi.fn();

  return {
    floorConfigured: () => true,
    floorClient: () => ({ runs: { list: listMock } }),
  };
});

function run(prUrl: string): RunView {
  return {
    id: `run-${prUrl}`,
    lineId: "auto-merge",
    lineHash: "hash",
    repo: "github.com/re-cinq/lore",
    subjectKey: `pr_url:${prUrl}`,
    startItems: { pr_url: { kind: "value", ref: prUrl, by: "lore" } },
    outcome: "success",
    reason: null,
    createdAt: "2026-10-23T06:28:00.000Z",
    finishedAt: "2026-10-23T06:40:00.000Z",
  } as RunView;
}

vi.mock("../../../outbound/project-boot.js", () => ({
  projectFor: vi.fn(),
}));

vi.mock(
  "@re-cinq/lore-shared/project/github-installations/lore-app-login.js",
  () => ({
    loreAppLogin: vi.fn(),
  }),
);

import { projectFor } from "../../../outbound/project-boot.js";
import { loreAppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";

describe("disarmAutoMerge", () => {
  it("enumerates all loop runs when they span multiple pages", async () => {
    const listMock = vi.mocked(floorClient().runs.list);

    listMock.mockResolvedValueOnce({
      items: [run("https://github.com/re-cinq/lore/pull/42")],
      nextCursor: "page-2",
    });
    listMock.mockResolvedValueOnce({
      items: [run("https://github.com/re-cinq/lore/pull/43")],
      nextCursor: null,
    });

    const cancelled: string[] = [];

    vi.mocked(projectFor).mockResolvedValue({
      pulls: {
        list: async () => [
          { number: 42, nodeId: "PR_42", author: "gedaiu", autoMerge: true },
          { number: 43, nodeId: "PR_43", author: "gedaiu", autoMerge: true },
          { number: 44, nodeId: "PR_44", author: "gedaiu", autoMerge: true },
        ],
        cancelAutoMerge: async (nodeId: string) => {
          cancelled.push(nodeId);
        },
      },
      audit: { write: async () => {} },
    } as never);
    vi.mocked(loreAppLogin).mockResolvedValue("lore-agent[bot]");

    await disarmAutoMerge("re-cinq/lore");

    expect(listMock.mock.calls).toEqual([
      [expect.any(Object), { limit: 100 }],
      [expect.any(Object), { limit: 100, cursor: "page-2" }],
    ]);
    expect(cancelled).toEqual(["PR_42", "PR_43"]);
  });
});
