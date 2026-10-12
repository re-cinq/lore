/** Points the repo's workflows back at Lore, before the onboarding PR opens. */

import { errorMessage } from "../../lib/error-classify.js";

/** The slice of `project.settings` the callback writes through. */
export interface IngestCallbackSettings {
  setRepoVariable(name: string, value: string): Promise<void>;
  setRepoSecret(name: string, value: string): Promise<void>;
}

/** Point the repo's workflows back at Lore, BEFORE the PR opens so a failure here is still reportable in the PR body. An unset value is never written as an empty variable — that would leave lore-ingest.yml failing on a blank URL while looking configured. */
export async function configureIngestCallback(
  settings: IngestCallbackSettings,
): Promise<string[]> {
  const failures: string[] = [];

  await setIngestVariable(settings, failures);
  await setIngestSecret(settings, failures);

  return failures;
}

async function setIngestVariable(
  settings: IngestCallbackSettings,
  failures: string[],
): Promise<void> {
  const url = process.env.LORE_INGEST_URL || "";

  if (!url) {
    failures.push(
      "`LORE_INGEST_URL` is not configured on the Lore deployment — set the repo variable manually or fix the deployment, or ingest calls will never reach Lore",
    );

    return;
  }

  await settings
    .setRepoVariable("LORE_INGEST_URL", url)
    .catch((err: unknown) =>
      failures.push(
        `the \`LORE_INGEST_URL\` repo variable could not be set: ${errorMessage(err)}`,
      ),
    );
}

async function setIngestSecret(
  settings: IngestCallbackSettings,
  failures: string[],
): Promise<void> {
  const token = process.env.LORE_INGEST_TOKEN;

  if (!token) {
    failures.push(
      "`LORE_INGEST_TOKEN` is not configured on the Lore deployment — set the repo secret manually, or every ingest call will be rejected with 401",
    );

    return;
  }

  await settings
    .setRepoSecret("LORE_INGEST_TOKEN", token)
    .catch((err: unknown) =>
      failures.push(
        `the \`LORE_INGEST_TOKEN\` repo secret could not be set: ${errorMessage(err)}`,
      ),
    );
}

/** Ingest-callback configuration is fail-soft; only the log line differs on success vs. partial failure. */
export function logIngestConfigResult(
  targetRepo: string,
  configFailures: string[],
): void {
  if (configFailures.length === 0) {
    console.log(`[onboard] Configured ingest secrets on ${targetRepo}`);

    return;
  }
  console.error(
    `[onboard] Ingest config incomplete on ${targetRepo}: ${configFailures.join("; ")}`,
  );
}
