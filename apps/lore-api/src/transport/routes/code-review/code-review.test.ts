import Hapi from "@hapi/hapi";
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../../outbound/project-boot.js", () => ({ projectFor: vi.fn() }));

import { projectFor } from "../../../outbound/project-boot.js";
import { codeReviewRoute } from "./code-review.js";
import type { FloorRunPageOf } from "../floor/floor-runs.js";
import type { FloorRunRow } from "../../../work/floor/floor-run-rows.js";

const PULL_URL = (number: number) =>
  `https://github.com/re-cinq/lore/pull/${number}`;

function openPull(number: number) {
  return {
    number,
    title: `Change ${number}`,
    url: PULL_URL(number),
    state: "open",
  };
}

function reviewRun(id: string, pr: number): FloorRunRow {
  return {
    id,
    blueprint_name: "code-review",
    definition_name: "code-review",
    task_id: null,
    repo: "re-cinq/lore",
    branch: null,
    subject_key: null,
    engine: "floor",
    status: "completed",
    outcome: "success",
    reason: null,
    created_at: "2026-10-26T08:30:00.000Z",
    started_at: null,
    finished_at: null,
    args_pr_number: pr,
    spec_plan_summary: null,
    pr_url: PULL_URL(pr),
    task_pr_number: null,
    issue_url: null,
    issue_number: null,
    created_by: null,
    cost_usd: null,
    pipeline: [],
  } as FloorRunRow;
}

describe("GET /api/repos/{owner}/{repo}/code-review", () => {
  afterEach(() => vi.clearAllMocks());

  function get(pageOf: FloorRunPageOf) {
    const server = Hapi.server();

    server.auth.scheme("stub", () => ({
      authenticate: (_r, h) => h.authenticated({ credentials: {} }),
    }));
    server.auth.strategy("bearer-scope", "stub");
    server.auth.default("bearer-scope");
    server.route(codeReviewRoute(pageOf));

    return server.inject("/api/repos/re-cinq/lore/code-review");
  }

  it("reads the open pull requests and thirty runs of each review line, and answers the queues", async () => {
    const asked: unknown[] = [];

    vi.mocked(projectFor).mockResolvedValue({
      settings: { record: async () => ({ fullName: "re-cinq/lore" }) },
      pulls: {
        list: async () => [
          {
            number: 7,
            title: "Fix login",
            url: "https://github.com/re-cinq/lore/pull/7",
            state: "open",
          },
          {
            number: 6,
            title: "Merged already",
            url: "https://github.com/re-cinq/lore/pull/6",
            state: "merged",
          },
        ],
      },
    } as never);

    const res = await get(async (query) => {
      asked.push(query);

      return { runs: [], next_cursor: null };
    });

    expect({ status: res.statusCode, body: res.result, asked }).toEqual({
      status: 200,
      body: {
        current: [],
        backlog: [
          expect.objectContaining({ pr_number: 7, state: "unreviewed" }),
        ],
        parked: [],
        awaiting_merge: [],
        recent: [],
      },
      asked: [
        ...["code-review", "code-review-recheck", "code-review-reply"].map(
          (line) => ({ repo: "re-cinq/lore", line, limit: 30 }),
        ),
        {
          repo: "re-cinq/lore",
          line: "code-review",
          subject: `pr_url:${PULL_URL(7)}`,
          limit: 1,
        },
      ],
    });
  });

  it("puts #3449, reviewed before the thirty newest runs, under awaiting merge and keeps the never-reviewed #3279 in the backlog", async () => {
    vi.mocked(projectFor).mockResolvedValue({
      settings: { record: async () => ({ fullName: "re-cinq/lore" }) },
      pulls: { list: async () => [openPull(3449), openPull(3279)] },
    } as never);

    const res = await get(async (query) => ({
      runs:
        query.subject === `pr_url:${PULL_URL(3449)}`
          ? [reviewRun("r-3449", 3449)]
          : [],
      next_cursor: null,
    }));

    expect(res.result).toMatchObject({
      backlog: [{ pr_number: 3279, state: "unreviewed" }],
      awaiting_merge: [{ pr_number: 3449, state: "success", run_id: "r-3449" }],
    });
  });

  it("answers 404 for a repo that is not onboarded without reading pull requests", async () => {
    const list = vi.fn();

    vi.mocked(projectFor).mockResolvedValue({
      settings: { record: async () => null },
      pulls: { list },
    } as never);

    const res = await get(async () => ({ runs: [], next_cursor: null }));

    expect({ status: res.statusCode, read: list.mock.calls.length }).toEqual({
      status: 404,
      read: 0,
    });
  });
});
