import { describe, it, expect, vi } from "vitest";
import { refreshUserToken } from "./github-user-client.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("refreshUserToken", () => {
  const refresh = {
    clientId: "client-1",
    clientSecret: "secret-1",
    refreshToken: "ghr_old",
  };

  it("posts the refresh_token grant and returns the new pair GitHub answers with", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: "ghu_new",
        expires_in: 28800,
        refresh_token: "ghr_new",
        refresh_token_expires_in: 15897600,
      }),
    );
    const pair = await refreshUserToken(refresh, fetchImpl);

    expect({
      pair,
      url: fetchImpl.mock.calls[0][0],
      body: JSON.parse(fetchImpl.mock.calls[0][1].body),
    }).toEqual({
      pair: {
        accessToken: "ghu_new",
        expiresIn: 28800,
        refreshToken: "ghr_new",
        refreshTokenExpiresIn: 15897600,
      },
      url: "https://github.com/login/oauth/access_token",
      body: {
        client_id: "client-1",
        client_secret: "secret-1",
        grant_type: "refresh_token",
        refresh_token: "ghr_old",
      },
    });
  });

  it("returns null when GitHub answers with an error status", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: "bad_refresh_token" }, { status: 400 }),
      );

    expect(await refreshUserToken(refresh, fetchImpl)).toBeNull();
  });

  it("returns null when GitHub answers 200 with an error body and no access token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "bad_refresh_token" }));

    expect(await refreshUserToken(refresh, fetchImpl)).toBeNull();
  });
});
