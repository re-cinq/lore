import { describe, expect, it } from "vitest";
import type { IssueRef } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type {
  LoopTickDeps,
  StartedTicket,
} from "@re-cinq/lore-shared/backlog/implementation-loop-tick.js";
import {
  LOOP_TICKET_START_EVENTS,
  loopTicketStartHandlers,
} from "./loop-ticket-start-handlers.js";

const issue = (number: number): IssueRef => ({
  repo: "acme/widgets",
  number,
  title: `Ticket ${number}`,
  state: "open",
  labels: [],
  url: `https://gh/acme/widgets/issues/${number}`,
  createdAt: "2026-08-01T00:00:00Z",
});

function scene(overrides: Partial<LoopTickDeps> = {}) {
  const started: StartedTicket[] = [];
  const tick: LoopTickDeps = {
    started: async (ticket) => {
      started.push(ticket);
    },
    listRepos: async () => ["acme/widgets"],
    rawSettings: async () => ({ implementation_loop: { enabled: true } }),
    isOnboarded: async () => true,
    countOpenTicketRuns: async () => 1,
    activeTaskByIssue: async () => null,
    listIssues: async () => [issue(9)],
    createTask: async () => ({ task_id: "task-9" }),
    setTaskColumns: async () => {},
    branchExists: async () => false,
    branchMerged: async () => undefined,
    openPrForBranch: async () => null,
    openBlockers: async () => [],
    ...overrides,
  };
  const handlers = loopTicketStartHandlers({ tick });
  const start = (params: Record<string, unknown>) =>
    handlers.get("loop.ticket.start")!(params);

  return { handlers, start, started };
}

describe("loopTicketStartHandlers", () => {
  it("answers loop.ticket.start, the one event it asks the bus for", () => {
    const { handlers } = scene();

    expect([...handlers.keys()]).toEqual([...LOOP_TICKET_START_EVENTS]);
  });

  it("starts ticket 9 of acme/widgets beside 1 open run when max_parallel is 1", async () => {
    const { start, started } = scene();

    await start({ repo: "acme/widgets", issue_number: 9 });

    expect(started).toMatchObject([
      { repo: "acme/widgets", issue: { number: 9 }, taskId: "task-9" },
    ]);
  });

  it("starts nothing for ticket 9 whose task is active", async () => {
    const { start, started } = scene({
      activeTaskByIssue: async () => ({ id: "task-0", status: "running" }),
    });

    await start({ repo: "acme/widgets", issue_number: 9 });

    expect(started).toEqual([]);
  });

  it("starts nothing for an event with no repo or no issue number", async () => {
    const { start, started } = scene();

    await start({ issue_number: 9 });
    await start({ repo: "acme/widgets" });

    expect(started).toEqual([]);
  });
});
