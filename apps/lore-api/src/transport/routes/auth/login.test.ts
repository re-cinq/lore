import { describe, it, expect } from "vitest";
import { loginRoute } from "./login.js";
import { serve, testDeps } from "./auth-test-server.js";

const RETURN = "http://localhost:3000/auth/callback";
const url = (returnUrl: string) =>
  `/api/auth/login?return=${encodeURIComponent(returnUrl)}`;

describe("GET /api/auth/login", () => {
  it("redirects to github with a state the callback can take once", async () => {
    const deps = testDeps();
    const res = await serve([loginRoute(deps)]).inject(url(RETURN));
    const location = new URL(res.headers.location as string);
    const state = location.searchParams.get("state") as string;

    expect({
      status: res.statusCode,
      target: `${location.origin}${location.pathname}`,
      client: location.searchParams.get("client_id"),
      callback: location.searchParams.get("redirect_uri"),
      first: await deps.handoffs.take(state, "state"),
      second: await deps.handoffs.take(state, "state"),
    }).toEqual({
      status: 302,
      target: "https://github.com/login/oauth/authorize",
      client: "client-1",
      callback: "https://lore-api.example/api/auth/callback",
      first: { returnUrl: RETURN, grant: null },
      second: null,
    });
  });

  it("answers 400 when the return url is another host", async () => {
    const res = await serve([loginRoute(testDeps())]).inject(
      url("https://evil.example/auth/callback"),
    );

    expect({ status: res.statusCode, body: JSON.parse(res.payload) }).toEqual({
      status: 400,
      body: { error: "return url not allowed" },
    });
  });

  it("answers 503 when github oauth is not configured", async () => {
    const res = await serve([loginRoute(testDeps({ config: null }))]).inject(
      url(RETURN),
    );

    expect({ status: res.statusCode, body: JSON.parse(res.payload) }).toEqual({
      status: 503,
      body: { error: "github oauth not configured" },
    });
  });

  it("answers 400 when no return url is given", async () => {
    const res = await serve([loginRoute(testDeps())]).inject("/api/auth/login");

    expect(res.statusCode).toBe(400);
  });
});
