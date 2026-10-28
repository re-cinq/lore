import { describe, it, expect, vi } from "vitest";
import { callbackRoute } from "./callback.js";
import { serve, testDeps } from "./auth-test-server.js";

const RETURN = "http://localhost:3000/auth/callback";

async function signIn(deps: ReturnType<typeof testDeps>) {
  const state = await deps.handoffs.put("state", {
    returnUrl: RETURN,
    grant: null,
  });
  const res = await serve([callbackRoute(deps)]).inject(
    `/api/auth/callback?code=gh-code&state=${state}`,
  );

  return { res, location: new URL(res.headers.location as string) };
}

describe("GET /api/auth/callback", () => {
  it("sends a member back with a redeem code that carries every repo GitHub shows them", async () => {
    const deps = testDeps();
    const { res, location } = await signIn(deps);
    const redeemed = await deps.handoffs.take(
      location.searchParams.get("code") as string,
      "redeem",
    );

    expect({
      status: res.statusCode,
      page: location.origin + location.pathname,
      redeemed,
    }).toEqual({
      status: 302,
      page: "http://localhost:3000/auth/callback",
      redeemed: {
        returnUrl: RETURN,
        grant: {
          login: "gedaiu",
          name: "Bogdan",
          avatarUrl: "https://a/1",
          scopes: ["read", "write", "task"],
          repos: ["re-cinq/lore", "someone/else"],
        },
      },
    });
  });

  it("gives an org admin the admin scope", async () => {
    const deps = testDeps({ github: { fetchOrgRole: async () => "admin" } });
    const { location } = await signIn(deps);
    const redeemed = await deps.handoffs.take(
      location.searchParams.get("code") as string,
      "redeem",
    );

    expect(redeemed?.grant?.scopes).toEqual(["admin"]);
  });

  it("sends a person outside the org back with auth_error=not_in_org", async () => {
    const { location } = await signIn(
      testDeps({ github: { fetchOrgRole: async () => null } }),
    );

    expect(location.searchParams.get("auth_error")).toBe("not_in_org");
  });

  it("sends a person back with auth_error=github_denied when the code exchange fails", async () => {
    const { location } = await signIn(
      testDeps({ github: { exchangeCode: async () => null } }),
    );

    expect(location.searchParams.get("auth_error")).toBe("github_denied");
  });

  it("lets every GitHub account in as a member when no org is configured", async () => {
    const deps = testDeps({
      config: {
        clientId: "c",
        clientSecret: "s",
        apiUrl: "https://lore-api.example",
        uiUrl: undefined,
        org: undefined,
      },
    });
    const { location } = await signIn(deps);
    const redeemed = await deps.handoffs.take(
      location.searchParams.get("code") as string,
      "redeem",
    );

    expect(redeemed?.grant).toMatchObject({
      scopes: ["read", "write", "task"],
      repos: ["re-cinq/lore", "someone/else"],
    });
  });

  it("sends a person who cancelled on GitHub back with auth_error=github_denied", async () => {
    const exchanged = vi.fn();
    const deps = testDeps({ github: { exchangeCode: exchanged } });
    const state = await deps.handoffs.put("state", {
      returnUrl: RETURN,
      grant: null,
    });
    const res = await serve([callbackRoute(deps)]).inject(
      `/api/auth/callback?error=access_denied&state=${state}`,
    );

    expect({
      location: new URL(res.headers.location as string).searchParams.get(
        "auth_error",
      ),
      exchanged: exchanged.mock.calls.length,
    }).toEqual({ location: "github_denied", exchanged: 0 });
  });

  it("answers 400 for a state that was already used", async () => {
    const deps = testDeps();
    const state = await deps.handoffs.put("state", {
      returnUrl: RETURN,
      grant: null,
    });
    const server = serve([callbackRoute(deps)]);

    await server.inject(`/api/auth/callback?code=gh-code&state=${state}`);
    const second = await server.inject(
      `/api/auth/callback?code=gh-code&state=${state}`,
    );

    expect({
      status: second.statusCode,
      body: JSON.parse(second.payload),
    }).toEqual({
      status: 400,
      body: { error: "sign-in expired, start again" },
    });
  });
});
