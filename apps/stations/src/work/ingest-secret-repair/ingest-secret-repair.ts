// Re-writes the ingest secret and URL on every onboarded repo. Repos enrolled before the onboarding step used lore-api's token hold one lore-api answers 403.

import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";

export interface IngestSecretRepairDeps {
  repos: () => Promise<string[]>;
  /** The onboarding step's own callback, answering what it could not set. */
  configure: (repo: string) => Promise<string[]>;
  log: (line: string) => void;
}

export async function ingestSecretRepair(
  deps: IngestSecretRepairDeps,
): Promise<string> {
  const repos = await deps.repos();
  const failedRepos: string[] = [];

  for (const repo of repos) {
    const failures = await deps
      .configure(repo)
      .catch((err: unknown) => [errorMessage(err)]);

    failures.forEach((failure) => deps.log(`${repo}: ${failure}`));

    if (failures.length > 0) {
      failedRepos.push(repo);
    }
  }

  return `ingest secret repair: ${repos.length - failedRepos.length} repaired, ${failedRepos.length} failed`;
}
