import { describe, it, expect } from "vitest";
import type { TokenScope } from "../../http/auth.js";
import { accessRoute, logoutRoute, meRoute } from "./session.js";
import {
  PRINCIPAL_HEADER,
  serve,
  testDeps,
  userPrincipal,
} from "./auth-test-server.js";

const asUser = (repos: string[], scopes?: TokenScope[]) => ({
  [PRINCIPAL_HEADER]: userPrincipal(repos, scopes),
});

describe("GET /api/auth/me", () => {
  it("answers the person behind a user token", async () => {
    const res = await serve([meRoute()]).inject({
      url: "/api/auth/me",
      headers: asUser(["re-cinq/lore"]),
    });

    expect(JSON.parse(res.payload)).toEqual({
      login: "gedaiu",
      name: "Bogdan",
      avatar_url: "https://a/1",
      scopes: ["read", "write", "task"],
    });
  });

  it("answers 403 for a token that is not a person's session", async () => {
    const res = await serve([meRoute()]).inject("/api/auth/me");

    expect({ status: res.statusCode, body: JSON.parse(res.payload) }).toEqual({
      status: 403,
      body: { error: "not a user session" },
    });
  });
});

describe("GET /api/auth/access", () => {
  const ask = (repo: string, headers?: Record<string, string>) =>
    serve([accessRoute()]).inject({
      url: `/api/auth/access?repo=${repo}`,
      headers,
    });

  it("answers allowed true for a repo in the person's list, whatever its case", async () => {
    const res = await ask("Re-Cinq/Lore", asUser(["re-cinq/lore"]));

    expect(JSON.parse(res.payload)).toEqual({ allowed: true });
  });

  it("answers allowed false for a repo outside the person's list", async () => {
    const res = await ask("someone/else", asUser(["re-cinq/lore"]));

    expect(JSON.parse(res.payload)).toEqual({ allowed: false });
  });

  it("answers allowed false for a repo outside the person's list even with the admin scope", async () => {
    const res = await ask("someone/else", asUser([], ["admin"]));

    expect(JSON.parse(res.payload)).toEqual({ allowed: false });
  });

  it("answers allowed true for a service token, which no person limits", async () => {
    const res = await ask("someone/else");

    expect(JSON.parse(res.payload)).toEqual({ allowed: true });
  });

  it("answers 400 when no repo is named", async () => {
    const res = await serve([accessRoute()]).inject("/api/auth/access");

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes the session token by its hash", async () => {
    const deps = testDeps();

    deps.query.mockResolvedValue({ rowCount: 1 });
    const res = await serve([logoutRoute(deps.getPool)]).inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: asUser([]),
    });

    expect({
      status: res.statusCode,
      revoked: deps.query.mock.calls[0][1],
    }).toEqual({
      status: 200,
      revoked: ["hash-1"],
    });
  });

  it("answers 400 for a token that has no session to end", async () => {
    const res = await serve([logoutRoute(testDeps().getPool)]).inject({
      method: "POST",
      url: "/api/auth/logout",
    });

    expect({ status: res.statusCode, body: JSON.parse(res.payload) }).toEqual({
      status: 400,
      body: { error: "no session to end" },
    });
  });
});
