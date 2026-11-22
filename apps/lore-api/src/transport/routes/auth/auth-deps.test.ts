import { afterEach, describe, expect, it, vi } from "vitest";
import { authDeps } from "./auth-deps.js";

describe("authDeps github repositories", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reads the person's repositories from the installation's list with their token", async () => {
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "777");
    const fetchStub = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            repositories: [{ full_name: "acme/app", owner: { login: "acme" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    vi.stubGlobal("fetch", fetchStub);

    const repos = await authDeps(() => null).github.fetchUserRepos("gho_tok");
    const [url, init] = fetchStub.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];

    expect(repos.map((repo) => repo.full_name)).toEqual(["acme/app"]);
    expect(url).toContain("/user/installations/777/repositories");
    expect(init.headers).toMatchObject({ Authorization: "Bearer gho_tok" });
  });

  it("refuses to read repositories while no installation is configured", async () => {
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "");
    const fetchStub = vi.fn();

    vi.stubGlobal("fetch", fetchStub);

    await expect(
      authDeps(() => null).github.fetchUserRepos("gho_tok"),
    ).rejects.toThrow();
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
