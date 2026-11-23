import { describe, expect, it } from "vitest";
import type { EventInsert } from "@re-cinq/lore-shared/project/events/event-reporter-port.js";
import type { IssueRef } from "@re-cinq/lore-shared/project/lib/github-port.js";
import {
  requestTicketStart,
  type TicketStartDeps,
} from "./ticket-start-decision.js";

const issue = (number: number): IssueRef => ({
  repo: "acme/widgets",
  number,
  title: `Ticket ${number}`,
  state: "open",
  labels: [],
  url: `https://gh/acme/widgets/issues/${number}`,
  createdAt: "2026-08-01T00:00:00Z",
});

function scene(overrides: Partial<TicketStartDeps["guards"]> = {}) {
  const events: EventInsert[] = [];
  const deps: TicketStartDeps = {
    guards: {
      rawSettings: async () => ({ implementation_loop: { enabled: true } }),
      isOnboarded: async () => true,
      listIssues: async () => [issue(9)],
      openBlockers: async () => [],
      activeTaskByIssue: async () => null,
      openPrForBranch: async () => null,
      ...overrides,
    },
    openRunOf: async () => null,
    report: {
      insert: async (event) => {
        events.push(event);
      },
    },
  };

  return { deps, events };
}

describe("requestTicketStart", () => {
  it("answers 202 and writes loop.ticket.start for acme/widgets issue 9", async () => {
    const { deps, events } = scene();

    const answer = await requestTicketStart(deps, "acme/widgets", 9);

    expect({ answer, events }).toEqual({
      answer: { status: 202, body: { ok: true, issue_number: 9 } },
      events: [
        {
          eventName: "loop.ticket.start",
          source: "internal",
          params: { repo: "acme/widgets", issue_number: 9 },
        },
      ],
    });
  });

  it("answers 409 with the run and writes nothing when ticket 9 already has run-9 open", async () => {
    const { deps, events } = scene();

    const answer = await requestTicketStart(
      { ...deps, openRunOf: async () => ({ id: "run-9" }) },
      "acme/widgets",
      9,
    );

    expect({ answer, events }).toEqual({
      answer: {
        status: 409,
        body: {
          error: "ticket 9 is already being worked",
          guard: "running",
          run_id: "run-9",
        },
      },
      events: [],
    });
  });

  it("answers 409 naming the guard and writes nothing when the repo is not onboarded", async () => {
    const { deps, events } = scene({ isOnboarded: async () => false });

    const answer = await requestTicketStart(deps, "acme/widgets", 9);

    expect({ answer, events }).toEqual({
      answer: {
        status: 409,
        body: {
          error: "ticket 9 cannot start: not_onboarded",
          guard: "not_onboarded",
        },
      },
      events: [],
    });
  });
});
