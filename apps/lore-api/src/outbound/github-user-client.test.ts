import { describe, it, expect, vi } from "vitest";
import {
  exchangeCode,
  fetchUserRepos,
  fetchOrgRole,
  fetchViewer,
} from "./github-user-client.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const app = {
  clientId: "client-1",
  clientSecret: "secret-1",
  code: "code-1",
  redirectUri: "https://api.example/api/auth/callback",
};

describe("exchangeCode", () => {
  it("returns the access token GitHub answers with", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "gho_abc" }));

    expect(await exchangeCode(app, fetchImpl)).toEqual({
      accessToken: "gho_abc",
    });
  });

  it("posts the client, secret, code and callback as json", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: "gho_abc" }));

    await exchangeCode(app, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://github.com/login/oauth/access_token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Accept: "application/json" }),
        body: JSON.stringify({
          client_id: "client-1",
          client_secret: "secret-1",
          code: "code-1",
          redirect_uri: "https://api.example/api/auth/callback",
        }),
      }),
    );
  });

  it("returns null when GitHub answers with an error instead of a token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "bad_verification_code" }));

    expect(await exchangeCode(app, fetchImpl)).toBeNull();
  });

  it("returns null when GitHub answers with a failure status", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, { status: 503 }));

    expect(await exchangeCode(app, fetchImpl)).toBeNull();
  });

  it("returns the token pair with expiries and refresh token when GitHub provides them", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: "ghu_access_1",
        expires_in: 28800,
        refresh_token: "ghr_refresh_1",
        refresh_token_expires_in: 15897600,
        token_type: "bearer",
      }),
    );

    expect(await exchangeCode(app, fetchImpl)).toEqual({
      accessToken: "ghu_access_1",
      expiresIn: 28800,
      refreshToken: "ghr_refresh_1",
      refreshTokenExpiresIn: 15897600,
    });
  });
});

describe("fetchViewer", () => {
  it("returns the signed-in person's login, name and avatar", async () => {
    const viewer = {
      login: "gedaiu",
      name: "Bogdan",
      avatar_url: "https://a/1",
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(viewer));

    expect(await fetchViewer("gho_abc", fetchImpl)).toEqual(viewer);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/user",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer gho_abc" }),
      }),
    );
  });

  it("returns the person's GitHub numeric id when GitHub sends one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 987654,
        login: "gedaiu",
        name: "Bogdan",
        avatar_url: "https://a/1",
      }),
    );

    expect(await fetchViewer("gho_abc", fetchImpl)).toMatchObject({
      id: 987654,
    });
  });

  it("returns null when GitHub refuses the token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, { status: 401 }));

    expect(await fetchViewer("gho_abc", fetchImpl)).toBeNull();
  });

  it("returns null when GitHub answers a viewer with an empty login", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ login: "", name: "Ada" }));

    expect(await fetchViewer("gho_abc", fetchImpl)).toBeNull();
  });
});

describe("fetchOrgRole", () => {
  it("returns admin for an active org admin", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ state: "active", role: "admin" }));

    expect(await fetchOrgRole("gho_abc", "re-cinq", fetchImpl)).toBe("admin");
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://api.github.com/user/memberships/orgs/re-cinq",
    );
  });

  it("returns member for an active org member", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ state: "active", role: "member" }));

    expect(await fetchOrgRole("gho_abc", "re-cinq", fetchImpl)).toBe("member");
  });

  it("returns null for an invitation that is still pending", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ state: "pending", role: "member" }));

    expect(await fetchOrgRole("gho_abc", "re-cinq", fetchImpl)).toBeNull();
  });

  it("returns null for a person outside the org", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, { status: 404 }));

    expect(await fetchOrgRole("gho_abc", "re-cinq", fetchImpl)).toBeNull();
  });
});

describe("fetchUserRepos", () => {
  const repo = (name: string) => ({
    full_name: name,
    owner: { login: "re-cinq" },
  });

  it("follows the next page link and stops after it", async () => {
    const next = "https://api.github.com/user/repos?page=2";
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([repo("re-cinq/a")], {
          headers: { link: `<${next}>; rel="next"` },
        }),
      )
      .mockResolvedValueOnce(jsonResponse([repo("re-cinq/b")]));

    expect(await fetchUserRepos("gho_abc", fetchImpl)).toEqual([
      repo("re-cinq/a"),
      repo("re-cinq/b"),
    ]);
    expect(fetchImpl.mock.calls[1][0]).toBe(next);
  });

  it("stops after ten pages even when GitHub keeps offering a next one", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () =>
      jsonResponse([repo("re-cinq/a")], {
        headers: {
          link: '<https://api.github.com/user/repos?page=n>; rel="next"',
        },
      }),
    );

    await fetchUserRepos("gho_abc", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(10);
  });

  it("returns the repos read so far when a later page fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([repo("re-cinq/a")], {
          headers: {
            link: '<https://api.github.com/user/repos?page=2>; rel="next"',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}, { status: 500 }));

    expect(await fetchUserRepos("gho_abc", fetchImpl)).toEqual([
      repo("re-cinq/a"),
    ]);
  });
});

describe("GitHub Enterprise Server host ghe.example.com", () => {
  function recordingFetch(body: unknown) {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(String(input));

      return jsonResponse(body);
    };

    return { urls, fetchImpl };
  }

  it("exchanges the code at https://ghe.example.com/login/oauth/access_token", async () => {
    const { urls, fetchImpl } = recordingFetch({ access_token: "gho_abc" });

    await exchangeCode(app, fetchImpl, "ghe.example.com");

    expect(urls).toEqual(["https://ghe.example.com/login/oauth/access_token"]);
  });

  it("reads the viewer at https://ghe.example.com/api/v3/user", async () => {
    const { urls, fetchImpl } = recordingFetch({ login: "octocat" });

    await fetchViewer("gho_abc", fetchImpl, "ghe.example.com");

    expect(urls).toEqual(["https://ghe.example.com/api/v3/user"]);
  });

  it("reads the org role at https://ghe.example.com/api/v3/user/memberships/orgs/re-cinq", async () => {
    const { urls, fetchImpl } = recordingFetch({ state: "active" });

    await fetchOrgRole("gho_abc", "re-cinq", fetchImpl, "ghe.example.com");

    expect(urls).toEqual([
      "https://ghe.example.com/api/v3/user/memberships/orgs/re-cinq",
    ]);
  });

  it("reads the repos at https://ghe.example.com/api/v3/user/repos", async () => {
    const { urls, fetchImpl } = recordingFetch([]);

    await fetchUserRepos("gho_abc", fetchImpl, "ghe.example.com");

    expect(urls).toEqual([
      "https://ghe.example.com/api/v3/user/repos?per_page=100&affiliation=owner,collaborator,organization_member",
    ]);
  });
});
