import { getOctokit } from "../../outbound/github-client.js";
import {
  resolveInstallations,
  type InstallationsSource,
} from "../../outbound/github-client-auth.js";

export interface InstallationRepo {
  full_name: string;
  owner: string;
  name: string;
}

const INSTALLATION_PAGE_SIZE = 100;

/** Lists all repositories accessible across recorded GitHub App installations, falling back to GITHUB_APP_INSTALLATION_ID when none are recorded. An installation GitHub refuses (suspended, uninstalled) is skipped, so one org cannot hide every other org's repositories. */
export async function getInstallationRepos(
  source?: InstallationsSource,
): Promise<InstallationRepo[]> {
  const installations = resolveInstallations(source);
  const recorded = installations ? await installations.list() : [];

  if (recorded.length === 0) {
    return listForInstallation();
  }
  const perInstallation = await Promise.allSettled(
    recorded.map((entry) => listForInstallation(entry.installationId)),
  );

  return deduplicateRepos(
    perInstallation.flatMap((outcome, index) =>
      outcome.status === "fulfilled"
        ? outcome.value
        : skipRefusedInstallation(recorded[index].accountLogin, outcome.reason),
    ),
  );
}

function skipRefusedInstallation(
  accountLogin: string,
  reason: unknown,
): InstallationRepo[] {
  console.warn(
    `[repos] skipping the installation on ${accountLogin}: ${reason instanceof Error ? reason.message : String(reason)}`,
  );

  return [];
}

async function listForInstallation(
  installationId?: string,
): Promise<InstallationRepo[]> {
  const { rest } = await getOctokit(
    installationId ? { installationId } : undefined,
  );
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

function deduplicateRepos(repos: InstallationRepo[]): InstallationRepo[] {
  const seen = new Set<string>();

  return repos.filter((repo) => {
    const key = repo.full_name.toLowerCase();

    if (seen.has(key)) {
      return false;
    }
    seen.add(key);

    return true;
  });
}
