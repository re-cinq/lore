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

    expect(await exchangeCode(app, fetchImpl)).toBe("gho_abc");
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

  it("returns null when GitHub refuses the token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, { status: 401 }));

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
