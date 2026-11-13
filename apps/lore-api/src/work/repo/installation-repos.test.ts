import { describe, it, expect, vi } from "vitest";

const listReposAccessibleToInstallation = vi.fn();

vi.mock("../../outbound/github-client.js", () => ({
  getOctokit: async () => ({
    rest: { apps: { listReposAccessibleToInstallation } },
  }),
}));

import { getInstallationRepos } from "./installation-repos.js";

const repositories = (count: number, owner: string | null) =>
  Array.from({ length: count }, (_, index) => ({
    full_name: `re-cinq/repo-${owner ?? "bare"}-${index}`,
    owner: { login: owner },
    name: `repo-${owner ?? "bare"}-${index}`,
  }));

describe("getInstallationRepos", () => {
  it("reads a second page when the first holds 100 repos and returns all 101", async () => {
    listReposAccessibleToInstallation
      .mockResolvedValueOnce({
        data: { repositories: repositories(100, "re-cinq") },
      })
      .mockResolvedValueOnce({
        data: { repositories: repositories(1, "last") },
      });

    const repos = await getInstallationRepos();

    expect(repos).toHaveLength(101);
    expect(listReposAccessibleToInstallation).toHaveBeenCalledTimes(2);
  });

  it("takes the owner from the full name when GitHub leaves the login empty", async () => {
    listReposAccessibleToInstallation.mockReset().mockResolvedValueOnce({
      data: { repositories: repositories(1, null) },
    });

    expect(await getInstallationRepos()).toEqual([
      {
        full_name: "re-cinq/repo-bare-0",
        owner: "re-cinq",
        name: "repo-bare-0",
      },
    ]);
  });
});
