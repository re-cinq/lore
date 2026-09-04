/** Points the repo's workflows back at this Floor, before the onboarding PR opens. */

import { errorMessage } from "@re-cinq/lore-shared";
import { projectFor } from "../../composition/project-boot.js";

async function setIngestVariable(
  project: Awaited<ReturnType<typeof projectFor>>,
  failures: string[],
): Promise<void> {
  const url = process.env.LORE_INGEST_URL || "";

  if (!url) {
    failures.push(
      "`LORE_INGEST_URL` is not configured on the Floor — set the repo variable manually or fix the Floor deployment, or ingest calls will never reach Lore",
    );

    return;
  }
  await project.settings
    .setRepoVariable("LORE_INGEST_URL", url)
    .catch((err: unknown) =>
      failures.push(
        `the \`LORE_INGEST_URL\` repo variable could not be set: ${errorMessage(err)}`,
      ),
    );
}

async function setIngestSecret(
  project: Awaited<ReturnType<typeof projectFor>>,
  failures: string[],
): Promise<void> {
  const token = process.env.LORE_INGEST_TOKEN;

  if (!token) {
    failures.push(
      "`LORE_INGEST_TOKEN` is not configured on the Floor — set the repo secret manually, or every ingest call will be rejected with 401",
    );

    return;
  }
  await project.settings
    .setRepoSecret("LORE_INGEST_TOKEN", token)
    .catch((err: unknown) =>
      failures.push(
        `the \`LORE_INGEST_TOKEN\` repo secret could not be set: ${errorMessage(err)}`,
      ),
    );
}

/** Point the repo's workflows back at this Floor, BEFORE the PR opens so a failure here is still reportable in the PR body. An unset Floor value is never written as an empty variable — that would leave lore-ingest.yml failing on a blank URL while looking configured. */
export async function configureIngestCallback(
  project: Awaited<ReturnType<typeof projectFor>>,
): Promise<string[]> {
  const failures: string[] = [];

  await setIngestVariable(project, failures);
  await setIngestSecret(project, failures);

  return failures;
}

/** Ingest-callback configuration is fail-soft; only the log line differs on success vs. partial failure. */
export function logIngestConfigResult(
  targetRepo: string,
  configFailures: string[],
): void {
  if (configFailures.length === 0) {
    console.log(`[floor] Configured ingest secrets on ${targetRepo}`);

    return;
  }
  console.error(
    `[floor] Ingest config incomplete on ${targetRepo}: ${configFailures.join("; ")}`,
  );
}
