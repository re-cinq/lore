import { describe, it, expect, vi } from "vitest";

const listReposAccessibleToInstallation = vi.fn();

vi.mock("../../outbound/github-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../outbound/github-client.js")>()),
  getOctokit: async () => ({
    rest: { apps: { listReposAccessibleToInstallation } },
  }),
}));

import { InMemoryGithubInstallations } from "@re-cinq/lore-shared/project/github-installations/github-installations-memory.js";
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

  it("returns re-cinq's repos when GitHub refuses the suspended acme-corp installation", async () => {
    const installations = new InMemoryGithubInstallations(
      () => new Date("2026-11-21T00:00:00.000Z"),
    );

    for (const [installationId, accountLogin] of [
      ["81111111", "acme-corp"],
      ["82222222", "re-cinq"],
    ]) {
      await installations.upsert({
        installationId,
        accountLogin,
        accountType: "Organization",
        repositorySelection: "all",
        suspendedAt: null,
      });
    }
    listReposAccessibleToInstallation
      .mockReset()
      .mockRejectedValueOnce(new Error("This installation has been suspended"))
      .mockResolvedValueOnce({
        data: { repositories: repositories(1, "re-cinq") },
      });

    expect(await getInstallationRepos(installations)).toEqual([
      {
        full_name: "re-cinq/repo-re-cinq-0",
        owner: "re-cinq",
        name: "repo-re-cinq-0",
      },
    ]);
  });
});
