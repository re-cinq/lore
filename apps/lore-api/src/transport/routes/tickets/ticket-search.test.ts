import { describe, it, expect, beforeEach, vi } from "vitest";
import type { IssueRef } from "@re-cinq/lore-shared";
import type { SearchHit } from "@re-cinq/lore-shared/utopia/read-shapes.js";

const REPO = "re-cinq/lore";
const ISSUES_SOURCE = "src-issues";

const issue = (number: number, state: IssueRef["state"]): IssueRef => ({
  repo: REPO,
  number,
  title: `Ticket ${number}`,
  state,
  labels: ["priority:p2"],
  url: `https://github.com/${REPO}/issues/${number}`,
});

const ISSUES: Record<number, IssueRef> = {
  12: issue(12, "closed"),
  30: issue(30, "open"),
};

const world = {
  settings: { utopia: { kb_id: "kb-1" } } as Record<string, unknown> | null,
  hits: [] as SearchHit[],
};

vi.mock("../../../outbound/project-boot.js", () => ({
  projectFor: async () => ({
    issues: { get: async (n: number) => ISSUES[n] ?? null },
    settings: {
      record: async () => ({ fullName: REPO }),
      rawSettings: async () => world.settings,
    },
  }),
}));
vi.mock("@re-cinq/lore-shared/utopia/utopia-reads.js", () => ({
  utopiaReadsFrom: () => ({
    search: async () => ({
      hits: world.hits,
      hasMore: false,
      vectorUsed: true,
    }),
  }),
}));

import { buildServer } from "../../../app/build-server.js";
import {
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const issuesSourcePool = () => ({
  query: async () => ({
    rows: [{ id: ISSUES_SOURCE, key: "k", kbId: "kb-1" }],
  }),
});

const get = (query: string) =>
  buildServer(() => issuesSourcePool() as never).inject({
    method: "GET",
    url: `/api/repos/${REPO}/tickets/search?${query}`,
    headers: AUTH,
  });

const hit = (number: number, score: number): SearchHit => ({
  chunkId: `c${number}`,
  documentId: `d${number}`,
  seq: 0,
  text: `Issue: #${number} in ${REPO}`,
  filename: `issue-${number}.md`,
  sourceId: ISSUES_SOURCE,
  externalId: `issue:${number}`,
  score,
  bm25Rank: 1,
  vectorRank: 1,
});

describe("GET /api/repos/{owner}/{repo}/tickets/search", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    world.settings = { utopia: { kb_id: "kb-1" } };
    world.hits = [hit(30, 0.4), hit(12, 0.9)];
  });

  it("returns closed #12 then open #30 with GitHub's state, title and labels", async () => {
    const res = await get("query=search%20tickets");

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      tickets: [
        {
          number: 12,
          title: "Ticket 12",
          state: "closed",
          labels: ["priority:p2"],
          url: `https://github.com/${REPO}/issues/12`,
          score: 0.9,
          excerpt: `Issue: #12 in ${REPO}`,
        },
        expect.objectContaining({ number: 30, state: "open" }),
      ],
    });
  });

  it("returns only open #30 for state=open", async () => {
    const res = await get("query=search&state=open");

    expect(JSON.parse(res.payload)).toMatchObject({
      tickets: [{ number: 30 }],
    });
  });

  it("returns one ticket for limit=1", async () => {
    const res = await get("query=search&limit=1");

    expect(JSON.parse(res.payload)).toMatchObject({
      tickets: [{ number: 12 }],
    });
  });

  it("returns no tickets and a note when the repo has no Utopia base", async () => {
    world.settings = {};

    const res = await get("query=search");

    expect(JSON.parse(res.payload)).toEqual({
      tickets: [],
      notes: [`search_tickets: ${REPO} has no Utopia base`],
    });
  });

  it("drops a hit whose issue GitHub no longer has", async () => {
    world.hits = [hit(99, 0.99), hit(30, 0.4)];

    const res = await get("query=search");

    expect(JSON.parse(res.payload)).toMatchObject({
      tickets: [{ number: 30 }],
    });
  });

  it("answers 400 for a missing query", async () => {
    const res = await get("state=open");

    expect(res.statusCode).toBe(400);
  });
});
