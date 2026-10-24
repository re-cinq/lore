import Hapi from "@hapi/hapi";
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../../outbound/project-boot.js", () => ({ projectFor: vi.fn() }));

import { projectFor } from "../../../outbound/project-boot.js";
import { specTicketsRoute } from "./spec-tickets.js";
import type { FloorRunPageOf } from "../floor/floor-runs.js";

function serve(pageOf: FloorRunPageOf) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(specTicketsRoute(pageOf));

  return server;
}

describe("GET /api/repos/{owner}/{repo}/spec-tickets", () => {
  afterEach(() => vi.clearAllMocks());

  it("reads the spec-tickets line's 40 newest runs of re-cinq/lore and answers the widgets run under current", async () => {
    const asked: unknown[] = [];

    vi.mocked(projectFor).mockResolvedValue({
      settings: { record: async () => ({ fullName: "re-cinq/lore" }) },
    } as never);

    const res = await serve(async (query) => {
      asked.push(query);

      return {
        runs: [
          {
            id: "r1",
            subject_key: "key:re-cinq/lore:specs/widgets/spec.md@abc",
            status: "running",
            outcome: null,
            reason: null,
            created_at: "2026-10-20T10:00:00Z",
            pipeline: [],
          } as never,
        ],
        next_cursor: null,
      };
    }).inject("/api/repos/re-cinq/lore/spec-tickets");
    const body = JSON.parse(res.payload);

    expect({
      status: res.statusCode,
      asked,
      current: body.current.map((row: { ref: string }) => row.ref),
    }).toEqual({
      status: 200,
      asked: [{ repo: "re-cinq/lore", line: "spec-tickets", limit: 40 }],
      current: ["widgets"],
    });
  });

  it("answers 404 for a repo that is not onboarded without reading the floor", async () => {
    const asked: unknown[] = [];

    vi.mocked(projectFor).mockResolvedValue({
      settings: { record: async () => null },
    } as never);

    const res = await serve(async (query) => {
      asked.push(query);

      return { runs: [], next_cursor: null };
    }).inject("/api/repos/re-cinq/lore/spec-tickets");

    expect({ status: res.statusCode, asked }).toEqual({
      status: 404,
      asked: [],
    });
  });
});
