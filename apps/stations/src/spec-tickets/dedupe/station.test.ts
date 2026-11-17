import type { Tools } from "@re-cinq/floor-station";
import type { LlmToolResult } from "@re-cinq/lore-shared/llm/llm-provider.js";
import type {
  TicketSearchAnswer,
  TicketSearchRequest,
} from "@re-cinq/lore-shared/project/lib/station-http.js";
import { describe, expect, it } from "vitest";
import { dedupeHandle, type DedupeDeps } from "./station.js";

function planned(id: string, title: string) {
  return {
    id,
    title,
    description: `Build ${title.toLowerCase()}.`,
    depends_on: [],
    parallelizable: false,
    phase: 0,
  };
}

const DECOMPOSITION = {
  spec_commit: "c1",
  stories: [
    {
      title: "Login",
      summary: "",
      acceptance_criteria: [],
      tasks: [
        planned("T001", "Add login"),
        planned("T002", "Add logout"),
        planned("T003", "Add signup"),
      ],
    },
  ],
};
const EXISTING = [
  { id: "T002", title: "Add logout", number: 5, state: "open", body: "" },
];

function ticket(number: number, score: number) {
  return {
    number,
    title: `Ticket ${number}`,
    state: "open" as const,
    labels: [],
    url: null,
    score,
    excerpt: "",
  };
}

function answered(parsed: unknown): LlmToolResult<unknown> {
  return {
    parsed,
    model: "fake",
    inputTokens: 1,
    outputTokens: 1,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    durationMs: 0,
  };
}

function scene(deps: DedupeDeps) {
  const produced: Record<string, string> = {};
  const requests: TicketSearchRequest[] = [];
  const prompts: string[] = [];
  const bag: Record<string, string> = {
    verified_decomposition: JSON.stringify(DECOMPOSITION),
    existing_tickets: JSON.stringify(EXISTING),
  };
  const tools: Tools = {
    read: async (name) => Buffer.from(bag[name] ?? ""),
    produce: async (name, bytes) => {
      produced[name] = bytes.toString();
    },
    modelCall: async () => {},
    signal: new AbortController().signal,
  };
  const handle = dedupeHandle({
    search: (request) => {
      requests.push(request);

      return deps.search(request);
    },
    judge: (prompt) => {
      prompts.push(prompt);

      return deps.judge(prompt);
    },
  });
  const run = () =>
    handle(
      {
        visitId: "dedupe-1",
        iteration: 1,
        needs: {
          target: "https://github.com/acme/widget@main",
          verified_decomposition: "blob-1",
          existing_tickets: "blob-2",
        },
      },
      tools,
    );

  return { produced, requests, prompts, run };
}

const SEARCHES: Record<string, TicketSearchAnswer> = {
  "Add login\nBuild add login.": { tickets: [ticket(7, 0.03)] },
  "Add signup\nBuild add signup.": { tickets: [ticket(8, 0.02)] },
};

describe("dedupeHandle", () => {
  it("searches new tasks T001 and T003, judges only T001 whose #7 is a candidate, and drops it as duplicate_of #7", async () => {
    const { produced, requests, prompts, run } = scene({
      search: async ({ query }) => SEARCHES[query] ?? { tickets: [] },
      judge: async () =>
        answered({ verdict: "duplicate", ticket: 7, why: "same login" }),
    });

    expect(await run()).toEqual({ outcome: "success" });
    expect({
      searched: requests.map(({ query, state, limit }) => [
        query,
        state,
        limit,
      ]),
      judged: prompts.length,
      kept: JSON.parse(
        produced.deduped_decomposition ?? "{}",
      ).stories[0].tasks.map((task: { id: string }) => task.id),
      report: produced.dedupe_report,
    }).toEqual({
      searched: [
        ["Add login\nBuild add login.", "all", 5],
        ["Add signup\nBuild add signup.", "all", 5],
      ],
      judged: 1,
      kept: ["T002", "T003"],
      report: "## Ticket dedupe\n\n- T001: duplicate_of #7 — same login",
    });
  });

  it("keeps every task and reports both failures when the search throws a 503 and the judge is never asked", async () => {
    const { produced, prompts, run } = scene({
      search: async () => {
        throw new Error("GET /tickets/search failed: 503");
      },
      judge: async () => answered({ verdict: "new", why: "x" }),
    });

    expect(await run()).toEqual({ outcome: "success" });
    expect({
      decomposition: JSON.parse(produced.deduped_decomposition ?? "{}"),
      judged: prompts.length,
      report: produced.dedupe_report,
    }).toEqual({
      decomposition: DECOMPOSITION,
      judged: 0,
      report:
        "## Ticket dedupe\n\n- T001: kept, search_failed: GET /tickets/search failed: 503\n- T003: kept, search_failed: GET /tickets/search failed: 503",
    });
  });

  it("keeps T001 and reports judge_failed when the judge throws", async () => {
    const { produced, run } = scene({
      search: async ({ query }) => SEARCHES[query] ?? { tickets: [] },
      judge: async () => {
        throw new Error("vertex 503");
      },
    });

    expect(await run()).toEqual({ outcome: "success" });
    expect(produced.dedupe_report).toBe(
      "## Ticket dedupe\n\n- T001: kept, judge_failed: vertex 503",
    );
  });

  it("keeps T001 and reports the note when the search answers no Utopia base", async () => {
    const note = "search_tickets: acme/widget has no Utopia base";
    const { produced, run } = scene({
      search: async () => ({ tickets: [], notes: [note] }),
      judge: async () => answered({ verdict: "new", why: "x" }),
    });

    await run();

    expect(produced.dedupe_report).toBe(
      `## Ticket dedupe\n\n- T001: kept, search_failed: ${note}\n- T003: kept, search_failed: ${note}`,
    );
  });
});
