// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  sessionTokenOf,
  freshSessionToken,
  type SessionToken,
} from "./github-session-token";

const NOW = Date.parse("2026-09-21T12:00:00Z");
const CLIENT = { clientId: "Iv23client", clientSecret: "shh" };

const signedIn: SessionToken = {
  accessToken: "ghu_old",
  refreshToken: "ghr_old",
  accessTokenExpires: NOW - 60_000,
};

const answer = (status: number, body: object) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe("sessionTokenOf", () => {
  it("keeps the GitHub App's refresh token and the access token's expiry from sign-in", () => {
    expect(
      sessionTokenOf({
        access_token: "ghu_1",
        refresh_token: "ghr_1",
        expires_at: 1_790_000_000,
      }),
    ).toEqual({
      accessToken: "ghu_1",
      refreshToken: "ghr_1",
      accessTokenExpires: 1_790_000_000_000,
    });
  });

  it("keeps a classic OAuth token that never expires without an expiry", () => {
    expect(sessionTokenOf({ access_token: "gho_1" })).toEqual({
      accessToken: "gho_1",
    });
  });
});

describe("freshSessionToken", () => {
  it("keeps a token that expires in an hour without asking GitHub", async () => {
    const fetchMock = answer(200, {});

    vi.stubGlobal("fetch", fetchMock);
    const token = { ...signedIn, accessTokenExpires: NOW + 3_600_000 };

    expect({
      token: await freshSessionToken(token, CLIENT, NOW),
      calls: fetchMock.mock.calls.length,
    }).toEqual({ token, calls: 0 });
  });

  it("keeps a token that never expires without asking GitHub", async () => {
    const fetchMock = answer(200, {});

    vi.stubGlobal("fetch", fetchMock);

    expect({
      token: await freshSessionToken({ accessToken: "gho_1" }, CLIENT, NOW),
      calls: fetchMock.mock.calls.length,
    }).toEqual({ token: { accessToken: "gho_1" }, calls: 0 });
  });

  it("trades an expired token's refresh token for a new pair through GitHub's refresh grant", async () => {
    const fetchMock = answer(200, {
      access_token: "ghu_new",
      refresh_token: "ghr_new",
      expires_in: 28_800,
    });

    vi.stubGlobal("fetch", fetchMock);
    const token = await freshSessionToken(signedIn, CLIENT, NOW);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];

    expect({ token, url, body: String(init.body) }).toEqual({
      token: {
        accessToken: "ghu_new",
        refreshToken: "ghr_new",
        accessTokenExpires: NOW + 28_800_000,
      },
      url: "https://github.com/login/oauth/access_token",
      body: "client_id=Iv23client&client_secret=shh&grant_type=refresh_token&refresh_token=ghr_old",
    });
  });

  it("drops the access token when GitHub refuses the refresh, so the person is asked to sign in again", async () => {
    vi.stubGlobal(
      "fetch",
      answer(200, { error: "bad_refresh_token", error_description: "expired" }),
    );

    expect(await freshSessionToken(signedIn, CLIENT, NOW)).toEqual({
      error: "RefreshAccessTokenError",
    });
  });
});
