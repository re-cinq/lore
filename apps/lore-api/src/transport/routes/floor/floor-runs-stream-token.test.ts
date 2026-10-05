import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { memoryLiveTokens } from "../../../work/assembly-line-station/live-tokens.js";
import { zodFailAction } from "../../http/zod-validate.js";
import { floorRunsStreamTokenRoute } from "./floor-runs-stream-token.js";

function serve(
  mint: (user: {
    id: string;
    name: string;
  }) => Promise<{ token: string; expiresAt: Date }>,
) {
  const server = Hapi.server({
    routes: { validate: { failAction: zodFailAction } },
  });

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(floorRunsStreamTokenRoute(() => ({}) as never, { mint }));

  return server;
}

describe("POST /api/floor-runs/stream-token", () => {
  it("answers a token that opens the runs channel as u-1", async () => {
    const live = memoryLiveTokens();
    const server = serve(async (user) => ({
      token: live.mint({ kind: "runs", subject: "floor", user }),
      expiresAt: new Date("2026-10-02T10:10:00.000Z"),
    }));
    const res = await server.inject({
      method: "POST",
      url: "/api/floor-runs/stream-token",
      payload: { user: { id: "u-1", name: "Bogdan" } },
    });
    const { token } = JSON.parse(res.payload);

    expect({
      status: res.statusCode,
      principal: await live.verify(token, { kind: "runs", subject: "floor" }),
    }).toEqual({ status: 200, principal: { id: "u-1", name: "Bogdan" } });
  });
});
