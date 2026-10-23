import Hapi from "@hapi/hapi";
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../../outbound/project-boot.js", () => ({ projectFor: vi.fn() }));

import { projectFor } from "../../../outbound/project-boot.js";
import { specUpkeepRoute } from "./spec-upkeep.js";
import type { FloorRunPageOf } from "../floor/floor-runs.js";

const PR = (n: number) => `https://github.com/re-cinq/lore/pull/${n}`;

function serve(pageOf: FloorRunPageOf) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(specUpkeepRoute(pageOf));

  return server;
}

describe("GET /api/repos/{owner}/{repo}/spec-upkeep", () => {
  afterEach(() => vi.clearAllMocks());

  it("reads the spec-upkeep line's runs and lists #40 on lore/spec-upkeep/2026-10-19 as awaiting merge, leaving #41 on another branch out", async () => {
    const asked: unknown[] = [];

    vi.mocked(projectFor).mockResolvedValue({
      settings: { record: async () => ({ fullName: "re-cinq/lore" }) },
      pulls: {
        list: async () => [
          {
            number: 40,
            title: "Spec upkeep",
            url: PR(40),
            state: "open",
            branch: "lore/spec-upkeep/2026-10-19",
          },
          {
            number: 41,
            title: "Fix",
            url: PR(41),
            state: "open",
            branch: "fix/a",
          },
        ],
        listMergedSince: async () => [],
      },
    } as never);

    const res = await serve(async (query) => {
      asked.push(query);

      return { runs: [], next_cursor: null };
    }).inject("/api/repos/re-cinq/lore/spec-upkeep");
    const body = JSON.parse(res.payload);

    expect({
      status: res.statusCode,
      asked,
      awaiting: body.awaiting_merge.map((row: { ref: string }) => row.ref),
    }).toEqual({
      status: 200,
      asked: [{ repo: "re-cinq/lore", line: "spec-upkeep", limit: 12 }],
      awaiting: ["#40"],
    });
  });

  it("answers 404 for a repo that is not onboarded without reading pull requests", async () => {
    const list = vi.fn();

    vi.mocked(projectFor).mockResolvedValue({
      settings: { record: async () => null },
      pulls: { list, listMergedSince: list },
    } as never);

    const res = await serve(async () => ({
      runs: [],
      next_cursor: null,
    })).inject("/api/repos/re-cinq/lore/spec-upkeep");

    expect({ status: res.statusCode, read: list.mock.calls.length }).toEqual({
      status: 404,
      read: 0,
    });
  });
});
