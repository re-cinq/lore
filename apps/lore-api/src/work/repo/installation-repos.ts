import { getOctokit } from "../../outbound/github-client.js";

export interface InstallationRepo {
  full_name: string;
  owner: string;
  name: string;
}

const INSTALLATION_PAGE_SIZE = 100;

/** Lists all repositories the GitHub App installation has access to. */
export async function getInstallationRepos(): Promise<InstallationRepo[]> {
  const { rest } = await getOctokit();
  const repos: InstallationRepo[] = [];

  for (let page = 1; ; page++) {
    const batch = await fetchInstallationPage(rest.apps, page);

    repos.push(...batch);

    if (batch.length < INSTALLATION_PAGE_SIZE) {
      break;
    }
  }

  return repos;
}

/** GitHub omits the owner login on some installation entries, so the full name is the fallback source for it. */
async function fetchInstallationPage(
  apps: Awaited<ReturnType<typeof getOctokit>>["rest"]["apps"],
  page: number,
): Promise<InstallationRepo[]> {
  const { data: listed } = await apps.listReposAccessibleToInstallation({
    per_page: INSTALLATION_PAGE_SIZE,
    page,
  });

  return listed.repositories.map(({ full_name, owner, name }) => ({
    full_name,
    owner: owner.login || full_name.split("/")[0],
    name,
  }));
}
