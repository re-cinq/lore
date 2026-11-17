import type { Tools } from "@re-cinq/floor-station";
import type {
  TicketSearchAnswer,
  TicketSearchRequest,
} from "@re-cinq/lore-shared/project/lib/station-http.js";
import { describe, expect, it } from "vitest";
import { dedupeHandle } from "./station.js";

const DECOMPOSITION = {
  spec_commit: "c1",
  stories: [
    {
      title: "Login",
      summary: "",
      acceptance_criteria: [],
      tasks: [
        {
          id: "T001",
          title: "Add login",
          description: "Build login.",
          depends_on: [],
          parallelizable: false,
          phase: 0,
        },
        {
          id: "T002",
          title: "Add logout",
          description: "Build logout.",
          depends_on: [],
          parallelizable: false,
          phase: 0,
        },
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

function scene(
  search: (request: TicketSearchRequest) => Promise<TicketSearchAnswer>,
) {
  const produced: Record<string, string> = {};
  const requests: TicketSearchRequest[] = [];
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

      return search(request);
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

  return { produced, requests, run };
}

describe("dedupeHandle", () => {
  it("searches only new task T001 and drops it as duplicate_of open #7, keeping rewrite T002", async () => {
    const { produced, requests, run } = scene(async () => ({
      tickets: [ticket(7, 0.95)],
    }));

    expect(await run()).toEqual({ outcome: "success" });
    expect({
      requests,
      kept: JSON.parse(
        produced.deduped_decomposition ?? "{}",
      ).stories[0].tasks.map((task: { id: string }) => task.id),
      report: produced.dedupe_report,
    }).toEqual({
      requests: [
        {
          repo: "acme/widget",
          query: "Add login\nBuild login.",
          state: "all",
          limit: 5,
        },
      ],
      kept: ["T002"],
      report: "## Ticket dedupe\n\n- T001: duplicate_of #7",
    });
  });

  it("keeps every task and reports the failure when the search throws a 503", async () => {
    const { produced, run } = scene(async () => {
      throw new Error("GET /tickets/search failed: 503");
    });

    expect(await run()).toEqual({ outcome: "success" });
    expect({
      decomposition: JSON.parse(produced.deduped_decomposition ?? "{}"),
      report: produced.dedupe_report,
    }).toEqual({
      decomposition: DECOMPOSITION,
      report:
        "## Ticket dedupe\n\n- T001: kept, search failed: GET /tickets/search failed: 503",
    });
  });
});
