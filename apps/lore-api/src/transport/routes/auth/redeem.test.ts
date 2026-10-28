import { describe, it, expect, vi, afterEach } from "vitest";
import { redeemRoute } from "./redeem.js";
import { serve, testDeps } from "./auth-test-server.js";
import { SESSION_TTL_MS } from "../../../work/auth/login-grant.js";

const grant = {
  login: "gedaiu",
  name: "Bogdan",
  avatarUrl: "https://a/1",
  scopes: ["read", "write", "task"],
  repos: ["re-cinq/lore"],
};

function redeemWith(code: string, server: ReturnType<typeof serve>) {
  return server.inject({
    method: "POST",
    url: "/api/auth/redeem",
    payload: { code },
  });
}

describe("POST /api/auth/redeem", () => {
  afterEach(() => vi.useRealTimers());

  it("redeems a code once and answers 401 the second time", async () => {
    const deps = testDeps();

    deps.query.mockResolvedValue({
      rows: [{ id: "t-1", name: "n", scopes: [], created_at: "now" }],
    });
    const code = await deps.handoffs.put("redeem", {
      returnUrl: "http://localhost:3000/x",
      grant,
    });
    const server = serve([redeemRoute(deps)]);

    const first = await redeemWith(code, server);
    const second = await redeemWith(code, server);

    expect({ first: first.statusCode, second: second.statusCode }).toEqual({
      first: 200,
      second: 401,
    });
  });

  it("answers the session token and the person it belongs to", async () => {
    const deps = testDeps();

    deps.query.mockResolvedValue({
      rows: [{ id: "t-1", name: "n", scopes: [], created_at: "now" }],
    });
    const code = await deps.handoffs.put("redeem", {
      returnUrl: "http://localhost:3000/x",
      grant,
    });
    const res = await redeemWith(code, serve([redeemRoute(deps)]));
    const body = JSON.parse(res.payload);

    expect({ token: body.token, user: body.user }).toEqual({
      token: expect.stringMatching(/^lore_[0-9a-f]{64}$/),
      user: { login: "gedaiu", name: "Bogdan", avatar_url: "https://a/1" },
    });
  });

  it("stores a user token that expires in eight hours with the person's repos", async () => {
    vi.useFakeTimers({
      now: new Date("2026-10-28T10:00:00Z"),
      toFake: ["Date"],
    });
    const deps = testDeps();

    deps.query.mockResolvedValue({
      rows: [{ id: "t-1", name: "n", scopes: [], created_at: "now" }],
    });
    const code = await deps.handoffs.put("redeem", {
      returnUrl: "http://localhost:3000/x",
      grant,
    });

    await redeemWith(code, serve([redeemRoute(deps)]));

    expect(deps.query.mock.calls[0][1]).toEqual([
      "web-ui session gedaiu",
      expect.any(String),
      ["read", "write", "task"],
      "gedaiu",
      new Date(Date.now() + SESSION_TTL_MS),
      "user",
      "gedaiu",
      "Bogdan",
      "https://a/1",
      ["re-cinq/lore"],
    ]);
  });

  it("answers 401 for a state code used as a redeem code", async () => {
    const deps = testDeps();
    const state = await deps.handoffs.put("state", {
      returnUrl: "http://localhost:3000/x",
      grant: null,
    });
    const res = await redeemWith(state, serve([redeemRoute(deps)]));

    expect(res.statusCode).toBe(401);
  });
});
