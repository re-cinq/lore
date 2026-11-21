import { describe, it, expect, vi } from "vitest";
import { fetchInstallationRepos } from "./github-user-client.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const repo = (name: string) => ({ full_name: name, owner: { login: "acme" } });
const pageUrl = (n: number) =>
  `https://api.github.com/user/installations/42/repositories?per_page=100&page=${n}`;

describe("fetchInstallationRepos", () => {
  it("reads every page of the installation repositories with no cap, using the person's token", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      const n = Number(new URL(url).searchParams.get("page") ?? "1");

      return jsonResponse(
        { repositories: [repo(`acme/r${n}`)] },
        n < 12 ? { headers: { link: `<${pageUrl(n + 1)}>; rel="next"` } } : {},
      );
    });

    const repos = await fetchInstallationRepos("ghu_x", "42", fetchImpl);

    expect({
      names: repos.map((r) => r.full_name),
      calls: fetchImpl.mock.calls.length,
      path: new URL(fetchImpl.mock.calls[0][0]).pathname,
      auth: fetchImpl.mock.calls[0][1].headers.Authorization,
    }).toEqual({
      names: Array.from({ length: 12 }, (_, i) => `acme/r${i + 1}`),
      calls: 12,
      path: "/user/installations/42/repositories",
      auth: "Bearer ghu_x",
    });
  });

  it("throws rather than return a partial list when a later page fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { repositories: [repo("acme/a")] },
          { headers: { link: `<${pageUrl(2)}>; rel="next"` } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({}, { status: 500 }));

    await expect(
      fetchInstallationRepos("ghu_x", "42", fetchImpl),
    ).rejects.toThrow(`GitHub answered 500 for ${pageUrl(2)}`);
  });
});
