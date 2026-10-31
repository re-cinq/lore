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

const BLOCK =
  "## Relevant Code\nscripts/context-evals/run.mjs owns the runner.\nThe route is POST /api/context-evals/ticket.\n## Agent Memory\nTickets with a priority label go to the loop.";

const JUDGED = {
  useful: [
    {
      fact: "run.mjs owns the runner",
      quote: "scripts/context-evals/run.mjs owns the runner",
    },
    {
      fact: "the route to post to",
      quote: "POST /api/context-evals/ticket",
    },
    {
      fact: "a file the block never names",
      quote: "apps/lore-api/src/work/context-evals/evaluate-ticket.ts",
    },
  ],
  background: true,
  noise: "The memory section is generic background.",
};

function scenario(judged = JUDGED) {
  const llm = new FakeLlm({ data: judged, usage: { model: "gemini-4-argon" } });
  const queries: string[] = [];
  const ticks = [0, 40, 100, 130];
  const deps: TicketDeps = {
    llm,
    clock: () => ticks.shift() ?? 0,
    assemble: async (_repo, query, backend) => {
      queries.push(`${backend}:${query.length}`);

      return { text: BLOCK, sections: ["adrs", "code"] };
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

  it("scores 2 for ticket 4024 when two of the three useful items quote the block, keeping only those two", async () => {
    const { deps } = scenario();

    expect(
      await evaluateTicket(deps, {
        repo: "re-cinq/lore",
        ticket: TICKET,
        backend: "lore",
      }),
    ).toEqual({
      score: 2,
      useful: ["run.mjs owns the runner", "the route to post to"],
      noise: "The memory section is generic background.",
      model: "gemini-4-argon",
      latency_ms: 40,
      chars: BLOCK.length,
      sections: ["adrs", "code"],
    });
  });

  it("scores 3 when three useful items quote the block", async () => {
    const { deps } = scenario({
      ...JUDGED,
      useful: [
        ...JUDGED.useful.slice(0, 2),
        { fact: "priority tickets", quote: "priority label go to the loop" },
      ],
    });

    expect(
      await evaluateTicket(deps, {
        repo: "re-cinq/lore",
        ticket: TICKET,
        backend: "lore",
      }),
    ).toMatchObject({ score: 3 });
  });

  it("scores 1 when no useful item quotes the block but the judge reports repo background", async () => {
    const { deps } = scenario({ ...JUDGED, useful: [JUDGED.useful[2]] });

    expect(
      await evaluateTicket(deps, {
        repo: "re-cinq/lore",
        ticket: TICKET,
        backend: "lore",
      }),
    ).toMatchObject({ score: 1, useful: [] });
  });

  it("scores 0 when nothing quotes the block and the judge reports no background", async () => {
    const { deps } = scenario({ ...JUDGED, useful: [], background: false });

    expect(
      await evaluateTicket(deps, {
        repo: "re-cinq/lore",
        ticket: TICKET,
        backend: "lore",
      }),
    ).toMatchObject({ score: 0, useful: [] });
  });

  it("counts no quote taken from the block's own <context query> header, which echoes the ticket, and hands the judge the block without it", async () => {
    const echoing = `<context query="Ticket 4024: run.mjs owns the runner\n\nEdit the route." template="implementation" budget="8000">\n${BLOCK}\n</context>`;
    const llm = new FakeLlm({
      data: {
        useful: [
          { fact: "the ticket's own words", quote: "Edit the route." },
          {
            fact: "the route to post to",
            quote: "POST /api/context-evals/ticket",
          },
        ],
        background: false,
        noise: "",
      },
      usage: { model: "gemini-4-argon" },
    });
    const verdict = await evaluateTicket(
      { llm, assemble: async () => ({ text: echoing, sections: ["code"] }) },
      { repo: "re-cinq/lore", ticket: TICKET, backend: "lore" },
    );
    const prompt = String(llm.calls[0]?.prompt);

    expect({
      score: verdict.score,
      useful: verdict.useful,
      judgeSawQuery: prompt.includes("<context query="),
      judgeSawBlock: prompt.includes("## Relevant Code"),
    }).toEqual({
      score: 2,
      useful: ["the route to post to"],
      judgeSawQuery: false,
      judgeSawBlock: true,
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

  it("asks the judge for a quote per useful item and puts the ticket in the request", async () => {
    const { deps, llm } = scenario();

    await evaluateTicket(deps, {
      repo: "re-cinq/lore",
      ticket: TICKET,
      backend: "utopia",
    });

    expect(llm.calls[0]).toMatchObject({
      prompt: expect.stringContaining("Context evals: a ticket-shaped mode"),
      systemPrompt: expect.stringContaining("copied word for word"),
    });
  });
});
