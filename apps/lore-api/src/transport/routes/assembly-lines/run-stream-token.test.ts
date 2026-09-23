import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import { zodFailAction } from "../../http/zod-validate.js";
import {
  runStreamTokenRoute,
  type RunStreamTokenDeps,
} from "./run-stream-token.js";

const EXPIRES = new Date("2026-09-23T10:10:00.000Z");

function serve(deps: RunStreamTokenDeps) {
  const server = Hapi.server({
    routes: { validate: { failAction: zodFailAction } },
  });

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(runStreamTokenRoute(() => ({}) as never, deps));

  return server;
}

function deps(runs = new InMemoryAssemblyRuns()) {
  const minted: { runId: string; user: { id: string; name: string } }[] = [];

  return {
    minted,
    route: {
      runs,
      mint: async (runId: string, user: { id: string; name: string }) => {
        minted.push({ runId, user });

        return { token: "opaque", expiresAt: EXPIRES };
      },
    },
  };
}

const post = (server: Hapi.Server, id: string, payload: object) =>
  server.inject({
    method: "POST",
    url: `/api/assembly-runs/${id}/stream-token`,
    payload,
  });

describe("POST /api/assembly-runs/{id}/stream-token", () => {
  it("mints a token bound to this run and this person", async () => {
    const runs = new InMemoryAssemblyRuns();
    const id = await runs.start({
      blueprintName: "implementation",
      repo: "o/r",
    });
    const d = deps(runs);
    const res = await post(serve(d.route), id, {
      user: { id: "ana", name: "Ana" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      token: "opaque",
      expires_at: "2026-09-23T10:10:00.000Z",
    });
    expect(d.minted).toEqual([{ runId: id, user: { id: "ana", name: "Ana" } }]);
  });

  it("answers 404 for a run that does not exist, minting nothing", async () => {
    const d = deps();
    const res = await post(serve(d.route), "nope", {
      user: { id: "ana", name: "Ana" },
    });

    expect(res.statusCode).toBe(404);
    expect(d.minted).toEqual([]);
  });

  it("answers 400 to a body without a user", async () => {
    const res = await post(serve(deps().route), "run-1", { role: "write" });

    expect(res.statusCode).toBe(400);
  });
});
