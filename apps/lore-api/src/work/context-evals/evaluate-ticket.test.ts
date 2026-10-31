import { describe, it, expect } from "vitest";
import { FakeLlm } from "@re-cinq/lore-shared/llm/fake-llm.js";
import {
  evaluateTicket,
  ticketQuery,
  type TicketDeps,
} from "./evaluate-ticket.js";

const TICKET = {
  number: 4024,
  title: "Context evals: a ticket-shaped mode",
  body: "x".repeat(900),
};

const GRADE = {
  score: 2,
  useful: ["scripts/context-evals/run.mjs owns the runner"],
  noise: "The memory section is generic background.",
};

function scenario() {
  const llm = new FakeLlm({ data: GRADE, usage: { model: "gemini-4-argon" } });
  const queries: string[] = [];
  const ticks = [0, 40, 100, 130];
  const deps: TicketDeps = {
    llm,
    clock: () => ticks.shift() ?? 0,
    assemble: async (_repo, query, backend) => {
      queries.push(`${backend}:${query.length}`);

      return { text: `block of ${backend}`, sections: ["adrs", "code"] };
    },
  };

  return { deps, llm, queries };
}

describe("evaluateTicket", () => {
  it("builds the query from the title and the first 700 characters of the body", () => {
    expect(ticketQuery(TICKET)).toEqual(
      `${TICKET.title}\n\n${"x".repeat(700)}`,
    );
  });

  it("grades the lore block of ticket 4024 with score 2 and the model's useful items", async () => {
    const { deps } = scenario();

    expect(
      await evaluateTicket(deps, {
        repo: "re-cinq/lore",
        ticket: TICKET,
        backend: "lore",
      }),
    ).toEqual({
      ...GRADE,
      model: "gemini-4-argon",
      latency_ms: 40,
      chars: "block of lore".length,
      sections: ["adrs", "code"],
    });
  });

  it("grades lore then utopia separately when the backend is both", async () => {
    const { deps, queries } = scenario();

    const verdict = await evaluateTicket(deps, {
      repo: "re-cinq/lore",
      ticket: TICKET,
      backend: "both",
    });

    expect({ queries, sides: Object.keys(verdict) }).toEqual({
      queries: ["lore:737", "utopia:737"],
      sides: ["lore", "utopia"],
    });
  });

  it("puts the 0 to 3 scale and the ticket in the judge's request", async () => {
    const { deps, llm } = scenario();

    await evaluateTicket(deps, {
      repo: "re-cinq/lore",
      ticket: TICKET,
      backend: "utopia",
    });

    expect(llm.calls[0]).toMatchObject({
      prompt: expect.stringContaining("Context evals: a ticket-shaped mode"),
      systemPrompt: expect.stringContaining("3 = several ticket-specific"),
    });
  });
});
