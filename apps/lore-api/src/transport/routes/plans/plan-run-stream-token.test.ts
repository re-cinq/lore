import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { zodFailAction } from "../../http/zod-validate.js";
import {
  planRunStreamTokenRoute,
  type PlanRunStreamTokenDeps,
} from "./plan-run-stream-token.js";

const EXPIRES = new Date("2026-11-06T10:10:00.000Z");
const ANA = { id: "ana", name: "Ana" };

function serve(deps: PlanRunStreamTokenDeps) {
  const server = Hapi.server({
    routes: { validate: { failAction: zodFailAction } },
  });

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(planRunStreamTokenRoute(() => ({}) as never, deps));

  return server;
}

function deps(plans: Record<string, string>) {
  const minted: { planId: string; user: typeof ANA }[] = [];

  return {
    minted,
    route: {
      planRepo: async (planId: string) => plans[planId] ?? null,
      mint: async (planId: string, user: typeof ANA) => {
        minted.push({ planId, user });

        return { token: "opaque", expiresAt: EXPIRES };
      },
    } satisfies PlanRunStreamTokenDeps,
  };
}

const post = (server: Hapi.Server, path: string, payload: object) =>
  server.inject({ method: "POST", url: path, payload });

describe("POST /api/repos/{owner}/{repo}/plans/{id}/run-stream-token", () => {
  it("mints a token bound to plan p1 of o/r for Ana", async () => {
    const d = deps({ p1: "o/r" });
    const res = await post(
      serve(d.route),
      "/api/repos/o/r/plans/p1/run-stream-token",
      { user: ANA },
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({
      token: "opaque",
      expires_at: "2026-11-06T10:10:00.000Z",
    });
    expect(d.minted).toEqual([{ planId: "p1", user: ANA }]);
  });

  it("answers 404 for plan p1 asked of another repository, minting nothing", async () => {
    const d = deps({ p1: "o/r" });
    const res = await post(
      serve(d.route),
      "/api/repos/o/other/plans/p1/run-stream-token",
      { user: ANA },
    );

    expect(res.statusCode).toBe(404);
    expect(d.minted).toEqual([]);
  });

  it("answers 404 for a plan that does not exist, minting nothing", async () => {
    const d = deps({});
    const res = await post(
      serve(d.route),
      "/api/repos/o/r/plans/gone/run-stream-token",
      { user: ANA },
    );

    expect(res.statusCode).toBe(404);
    expect(d.minted).toEqual([]);
  });

  it("answers 400 to a body without a user", async () => {
    const d = deps({ p1: "o/r" });
    const res = await post(
      serve(d.route),
      "/api/repos/o/r/plans/p1/run-stream-token",
      {},
    );

    expect(res.statusCode).toBe(400);
  });
});
