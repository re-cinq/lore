import Hapi from "@hapi/hapi";
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../../outbound/project-boot.js", () => ({ projectFor: vi.fn() }));

import { projectFor } from "../../../outbound/project-boot.js";
import { codeReviewRoute } from "./code-review.js";
import type { FloorRunPageOf } from "../floor/floor-runs.js";

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
      asked: ["code-review", "code-review-recheck", "code-review-reply"].map(
        (line) => ({ repo: "re-cinq/lore", line, limit: 30 }),
      ),
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
