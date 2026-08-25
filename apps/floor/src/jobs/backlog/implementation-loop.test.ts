import { describe, expect, it } from "vitest";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { IssueRef } from "@re-cinq/lore-shared";
import {
  createImplementationLoopTickHandler,
  type LoopTickDeps,
} from "./implementation-loop.js";

const issue = (number: number, labels: string[]): IssueRef => ({
  repo: "acme/widgets",
  number,
  title: `Ticket ${number}`,
  state: "open",
  labels,
  url: `https://gh/acme/widgets/issues/${number}`,
  createdAt: "2026-08-01T00:00:00Z",
});

function deps(overrides: Partial<LoopTickDeps> = {}) {
  const minted: Array<Record<string, unknown>> = [];
  const columns: Array<Record<string, unknown>> = [];
  const base: LoopTickDeps = {
    listRepos: async () => ["acme/widgets"],
    rawSettings: async () => ({ implementation_loop: { enabled: true } }),
    findOpenBySubject: async () => null,
    activeTaskByIssue: async () => null,
    listIssues: async () => [issue(7, ["priority:high"])],
    createTask: async (input) => {
      minted.push(input as unknown as Record<string, unknown>);

      return { task_id: "task-1" };
    },
    setTaskColumns: async (_taskId, cols) => {
      columns.push(cols);
    },
  };

  return { deps: { ...base, ...overrides }, minted, columns };
}

describe("createImplementationLoopTickHandler", () => {
  it("mints an implementation-loop task for the top-priority issue", async () => {
    const d = deps();

    await createImplementationLoopTickHandler(d.deps)({});

    expect(d.minted).toEqual([
      {
        description: "Ticket 7",
        taskType: "implementation-loop",
        targetRepo: "acme/widgets",
        createdBy: "implementation-loop",
        contextBundle: {
          github_issue_number: 7,
          github_issue_url: "https://gh/acme/widgets/issues/7",
        },
      },
    ]);
    expect(d.columns).toEqual([
      { issue_number: 7, issue_url: "https://gh/acme/widgets/issues/7" },
    ]);
  });

  it("does nothing for a repo whose toggle is off", async () => {
    const d = deps({ rawSettings: async () => ({}) });

    await createImplementationLoopTickHandler(d.deps)({});

    expect(d.minted).toEqual([]);
  });

  it("skips a repo whose backlog subject already has an open run", async () => {
    const d = deps({ findOpenBySubject: async () => ({ id: "run-1" }) });

    await createImplementationLoopTickHandler(d.deps)({});

    expect(d.minted).toEqual([]);
  });

  it("skips the pick while its task is still active (mint-to-run gap)", async () => {
    const d = deps({ activeTaskByIssue: async () => ({ id: "task-0" }) });

    await createImplementationLoopTickHandler(d.deps)({});

    expect(d.minted).toEqual([]);
  });

  it("leaves an empty backlog alone — no task minted", async () => {
    const d = deps({ listIssues: async () => [issue(7, ["bug"])] });

    await createImplementationLoopTickHandler(d.deps)({});

    expect(d.minted).toEqual([]);
  });

  it("scopes to the event's repo when params carry one", async () => {
    const asked: string[] = [];
    const d = deps({
      listRepos: async () => ["acme/widgets", "acme/other"],
      rawSettings: async (repo) => {
        asked.push(repo);

        return { implementation_loop: { enabled: true } };
      },
      listIssues: async () => [],
    });

    await createImplementationLoopTickHandler(d.deps)({ repo: "acme/other" });

    expect(asked).toEqual(["acme/other"]);
  });

  it("keeps ticking other repos when one repo throws", async () => {
    const d = deps({
      listRepos: async () => ["acme/broken", "acme/widgets"],
      rawSettings: async (repo) => {
        enforceTrue(repo !== "acme/broken", Error, "db down");

        return { implementation_loop: { enabled: true } };
      },
    });

    await createImplementationLoopTickHandler(d.deps)({});

    expect(d.minted).toHaveLength(1);
  });
});
