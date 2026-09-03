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
    branchExists: async () => false,
    openPrForBranch: async () => null,
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
          branch: "lore/implementation-loop/issue-7",
          line_args: {
            pr_draft: true,
            issue_number: 7,
            issue_title: "Ticket 7",
          },
        },
      },
    ]);
    expect(d.columns).toEqual([
      { issue_number: 7, issue_url: "https://gh/acme/widgets/issues/7" },
    ]);
  });

  it("mints the description with the issue body under the title", async () => {
    // The DoD node quotes the ticket's central claim (#1745); a description
    // minted from the title alone gave it a one-line ticket to define done
    // against, and bowman-ui #11 redefined exactly such a ticket.
    const d = deps({
      listIssues: async () => [
        {
          ...issue(7, ["priority:high"]),
          body: "248 links across 23 specs don't resolve.",
        },
      ],
    });

    await createImplementationLoopTickHandler(d.deps)({});

    expect(d.minted[0]).toMatchObject({
      description: "Ticket 7\n\n248 links across 23 specs don't resolve.",
    });
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

describe("the ticket's branch", () => {
  it("is named after the issue, so a re-pick finds the work already pushed", async () => {
    const d = deps();

    await createImplementationLoopTickHandler(d.deps)({});

    expect(d.minted[0].contextBundle).toMatchObject({
      branch: "lore/implementation-loop/issue-7",
    });
  });

  it("asks for a draft pull request, so twelve round-pushes get no review each", async () => {
    // The line, not the Floor, declares this: decidePrDraft reads args.pr_draft
    // so the Floor never learns which blueprints want a draft.
    const d = deps();

    await createImplementationLoopTickHandler(d.deps)({});

    expect(d.minted[0].contextBundle).toMatchObject({
      line_args: { pr_draft: true },
    });
  });

  it("seeds the issue number so the PR closes the ticket on merge", async () => {
    const d = deps();

    await createImplementationLoopTickHandler(d.deps)({});

    expect(d.minted[0].contextBundle).toMatchObject({
      line_args: { issue_number: 7 },
    });
  });

  it("seeds the ticket title so the draft PR is not titled after its branch", async () => {
    // `lore: lore/implementation-loop/issue-1744` told a reader nothing; the
    // ticket's own title is the only meaningful thing known when the draft opens.
    const d = deps();

    await createImplementationLoopTickHandler(d.deps)({});

    expect(d.minted[0].contextBundle).toMatchObject({
      line_args: { issue_title: "Ticket 7" },
    });
  });

  it("seeds no resume args when no branch exists yet", async () => {
    const d = deps();

    await createImplementationLoopTickHandler(d.deps)({});

    expect(d.minted[0].contextBundle).toMatchObject({
      line_args: { pr_draft: true },
    });
    expect(d.minted[0].contextBundle).not.toMatchObject({
      line_args: { resumed_from_branch: true },
    });
  });

  it("seeds line_args from the open pull request when the branch is being resumed", async () => {
    const d = deps({
      branchExists: async () => true,
      openPrForBranch: async () => ({
        number: 77,
        url: "https://gh/acme/widgets/pull/77",
      }),
    });

    await createImplementationLoopTickHandler(d.deps)({});

    expect(d.minted[0].contextBundle).toMatchObject({
      line_args: {
        resumed_from_branch: true,
        pr_number: 77,
        pr_url: "https://gh/acme/widgets/pull/77",
      },
    });
  });

  it("seeds no resume args for a blocked ticket even when its branch survives", async () => {
    const d = deps({
      listIssues: async () => [issue(7, ["priority:high", "lore:blocked"])],
      branchExists: async () => true,
    });

    await createImplementationLoopTickHandler(d.deps)({});

    // selectNextIssue already skips a blocked ticket, so nothing is minted at all —
    // the resume guard is the second lock on a door that is already shut.
    expect(d.minted).toEqual([]);
  });

  it("asks GitHub for the branch it is about to mint, not some other one", async () => {
    const asked: string[] = [];
    const d = deps({
      branchExists: async (_repo, branch) => {
        asked.push(branch);

        return false;
      },
    });

    await createImplementationLoopTickHandler(d.deps)({});

    expect(asked).toEqual(["lore/implementation-loop/issue-7"]);
  });
});

describe("a guarded head does not freeze the queue", () => {
  const twoTickets = async () => [
    issue(5, ["priority:medium"]),
    issue(9, ["priority:medium"]),
  ];

  it("skips a head whose task is completed-awaiting-merge and picks the next eligible ticket", async () => {
    const d = deps({
      listIssues: twoTickets,
      activeTaskByIssue: async (_repo, n) =>
        n === 5 ? { id: "done-task" } : null,
    });

    await createImplementationLoopTickHandler(d.deps)({});

    expect(d.minted).toMatchObject([
      { contextBundle: { github_issue_number: 9 } },
    ]);
  });

  it("says why when every eligible ticket is guarded, instead of exiting silently", async () => {
    const lines: string[] = [];
    const orig = console.log;

    console.log = (msg: string) => void lines.push(String(msg));

    try {
      const d = deps({
        listIssues: twoTickets,
        activeTaskByIssue: async () => ({ id: "t" }),
      });

      await createImplementationLoopTickHandler(d.deps)({});
      expect(d.minted).toEqual([]);
    } finally {
      console.log = orig;
    }
    expect(lines.filter((l) => l.includes("[implementation-loop]"))).toEqual([
      "[implementation-loop] acme/widgets: no pick — 2 eligible ticket(s), all awaiting an earlier task (#5, #9)",
    ]);
  });

  it("stays silent about an empty backlog — a normal state, not a stall", async () => {
    const lines: string[] = [];
    const orig = console.log;

    console.log = (msg: string) => void lines.push(String(msg));

    try {
      const d = deps({ listIssues: async () => [] });

      await createImplementationLoopTickHandler(d.deps)({});
    } finally {
      console.log = orig;
    }
    expect(lines.filter((l) => l.includes("no pick"))).toEqual([]);
  });
});
