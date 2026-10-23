import Hapi from "@hapi/hapi";
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../../outbound/project-boot.js", () => ({ projectFor: vi.fn() }));

import { projectFor } from "../../../outbound/project-boot.js";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { autoMergeRoute } from "./auto-merge.js";
import type { FloorRunPageOf } from "../floor/floor-runs.js";

const PR = (n: number) => `https://github.com/re-cinq/lore/pull/${n}`;

function serve(pool: unknown, pageOf: FloorRunPageOf) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(autoMergeRoute(() => pool as never, pageOf));

  return server;
}

describe("GET /api/repos/{owner}/{repo}/auto-merge", () => {
  afterEach(() => vi.clearAllMocks());

  it("puts a person's #7 whose review passed in the backlog, reads the loop's runs, and parks #8 its run left on a code owner", async () => {
    const pool = makePool();
    const asked: unknown[] = [];

    pool.query.mockResolvedValue({
      rows: [{ pr_number: "8", reason: "needs_code_owner", detail: null }],
    });
    vi.mocked(projectFor).mockResolvedValue({
      settings: {
        record: async () => ({ fullName: "re-cinq/lore" }),
        rawSettings: async () => ({ auto_merge: { enabled: true } }),
      },
      pulls: {
        list: async () => [
          {
            number: 7,
            title: "Fix",
            url: PR(7),
            state: "open",
            author: "gedaiu",
            headSha: "s7",
          },
          {
            number: 8,
            title: "Docs",
            url: PR(8),
            state: "open",
            author: "gedaiu",
            headSha: "s8",
          },
          {
            number: 9,
            title: "WIP",
            url: PR(9),
            state: "open",
            draft: true,
            headSha: "s9",
          },
        ],
        listMergedSince: async () => [],
        listChecks: async () => [
          {
            id: 1,
            name: "lore/code-review",
            status: "completed",
            conclusion: "success",
          },
        ],
      },
    } as never);

    const res = await serve(pool, async (query) => {
      asked.push(query);

      return {
        runs: [
          {
            id: "run-8",
            pr_url: PR(8),
            status: "completed",
            outcome: "success",
            reason: null,
            created_at: "2026-10-23T10:00:00Z",
            pipeline: [],
          },
        ] as never,
        next_cursor: null,
      };
    }).inject("/api/repos/re-cinq/lore/auto-merge");
    const body = JSON.parse(res.payload);

    expect({
      status: res.statusCode,
      asked,
      backlog: body.backlog.map((r: { pr_number: number }) => r.pr_number),
      parked: body.parked.map((r: { pr_number: number; blocked: string }) => [
        r.pr_number,
        r.blocked,
      ]),
    }).toEqual({
      status: 200,
      asked: [{ repo: "re-cinq/lore", line: "auto-merge", limit: 50 }],
      backlog: [7],
      parked: [[8, "Needs a code owner's approval"]],
    });
  });

  it("answers 404 for a repo that is not onboarded without reading pull requests", async () => {
    const list = vi.fn();

    vi.mocked(projectFor).mockResolvedValue({
      settings: { record: async () => null },
      pulls: { list, listMergedSince: list },
    } as never);

    const res = await serve(makePool(), async () => ({
      runs: [],
      next_cursor: null,
    })).inject("/api/repos/re-cinq/lore/auto-merge");

    expect({ status: res.statusCode, read: list.mock.calls.length }).toEqual({
      status: 404,
      read: 0,
    });
  });
});
