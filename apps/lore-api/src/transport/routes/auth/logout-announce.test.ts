import { describe, it, expect, vi } from "vitest";
import { onSessionEnded } from "../../../work/auth/session-ended.js";
import { logoutRoute } from "./session.js";
import {
  PRINCIPAL_HEADER,
  serve,
  testDeps,
  userPrincipal,
} from "./auth-test-server.js";

describe("POST /api/auth/logout announces the ended session", () => {
  it("announces the ended session row so its live sockets close", async () => {
    const deps = testDeps();
    const ended = vi.fn();
    const stop = onSessionEnded(ended);
    const principal = JSON.parse(userPrincipal([])) as {
      user: Record<string, unknown>;
    };

    principal.user.sessionId = "row-1";
    deps.query.mockResolvedValue({ rowCount: 1 });
    await serve([logoutRoute(deps.getPool)]).inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { [PRINCIPAL_HEADER]: JSON.stringify(principal) },
    });
    stop();

    expect(ended.mock.calls).toEqual([["row-1"]]);
  });

  it("announces nothing for a token that has no session to end", async () => {
    const deps = testDeps();
    const ended = vi.fn();
    const stop = onSessionEnded(ended);
    const res = await serve([logoutRoute(deps.getPool)]).inject({
      method: "POST",
      url: "/api/auth/logout",
    });

    stop();

    expect({ status: res.statusCode, announced: ended.mock.calls }).toEqual({
      status: 400,
      announced: [],
    });
  });
});
