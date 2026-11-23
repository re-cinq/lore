import { describe, expect, it } from "vitest";
import type { IssueRef } from "../../outbound/project/lib/github-port.js";
import type {
  LoopTickDeps,
  StartedTicket,
} from "./implementation-loop-tick.js";
import { guardNamedTicket, startNamedTicket } from "./named-ticket.js";

const issue = (number: number, extra: Partial<IssueRef> = {}): IssueRef => ({
  repo: "acme/widgets",
  number,
  title: `Ticket ${number}`,
  state: "open",
  labels: [],
  url: `https://gh/acme/widgets/issues/${number}`,
  createdAt: "2026-08-01T00:00:00Z",
  ...extra,
});

function scene(overrides: Partial<LoopTickDeps> = {}) {
  const started: StartedTicket[] = [];
  const deps: LoopTickDeps = {
    started: async (ticket) => {
      started.push(ticket);
    },
    listRepos: async () => ["acme/widgets"],
    rawSettings: async () => ({ implementation_loop: { enabled: true } }),
    isOnboarded: async () => true,
    countOpenTicketRuns: async () => 1,
    activeTaskByIssue: async () => null,
    listIssues: async () => [issue(9), issue(11)],
    createTask: async () => ({ task_id: "task-9" }),
    setTaskColumns: async () => {},
    branchExists: async () => false,
    branchMerged: async () => undefined,
    openPrForBranch: async () => null,
    openBlockers: async () => [],
    ...overrides,
  };

  return { deps, started };
}

describe("startNamedTicket", () => {
  it("starts ticket 9 beside 1 open run when max_parallel is 1, and answers null", async () => {
    const { deps, started } = scene();

    const refusal = await startNamedTicket("acme/widgets", 9, deps);

    expect({
      refusal,
      startedIssues: started.map((t) => t.issue.number),
    }).toEqual({ refusal: null, startedIssues: [9] });
  });

  it("starts ticket 9 on its own branch with its task", async () => {
    const { deps, started } = scene();

    await startNamedTicket("acme/widgets", 9, deps);

    expect(started[0]).toMatchObject({
      repo: "acme/widgets",
      taskId: "task-9",
      branch: "lore/implementation-loop/issue-9",
    });
  });

  it.each([
    [
      "loop_off",
      { rawSettings: async () => ({}) } satisfies Partial<LoopTickDeps>,
    ],
    [
      "loop_paused",
      {
        rawSettings: async () => ({
          implementation_loop: { enabled: true },
          loop_pauses: {
            implementation: {
              reason: "model credit ran out",
              run_id: null,
              at: "2026-11-20T00:00:00Z",
              until: null,
            },
          },
        }),
      },
    ],
    ["not_onboarded", { isOnboarded: async () => false }],
    ["issue_not_open", { listIssues: async () => [issue(11)] }],
    [
      "active_task",
      {
        activeTaskByIssue: async () => ({ id: "task-0", status: "running" }),
      },
    ],
    [
      "open_blocker",
      {
        listIssues: async () => [issue(9, { blockedByCount: 1 })],
        openBlockers: async () => [4],
      },
    ],
  ] as Array<[string, Partial<LoopTickDeps>]>)(
    "refuses ticket 9 with %s and starts no run",
    async (guard, overrides) => {
      const { deps, started } = scene(overrides);

      const refusal = await startNamedTicket("acme/widgets", 9, deps);

      expect({ refusal, started }).toEqual({ refusal: guard, started: [] });
    },
  );
});

describe("guardNamedTicket", () => {
  it("answers the open ticket 9 when no guard holds it", async () => {
    const { deps } = scene();

    expect(await guardNamedTicket("acme/widgets", 9, deps)).toEqual({
      issue: issue(9),
    });
  });

  it("answers the guard that holds ticket 9", async () => {
    const { deps } = scene({ isOnboarded: async () => false });

    expect(await guardNamedTicket("acme/widgets", 9, deps)).toEqual({
      guard: "not_onboarded",
    });
  });
});
