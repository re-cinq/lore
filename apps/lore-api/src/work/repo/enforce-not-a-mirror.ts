import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { SettingsPort } from "@re-cinq/lore-shared/project/settings/settings-port.js";

/** A repo another repo publishes to is never onboarded, switched on or given a credential, so nothing runs for it. */
export async function enforceNotAMirror(
  settings: Pick<SettingsPort, "mirrorOwner">,
  repo: string,
): Promise<void> {
  const ownerOfRepo = await settings.mirrorOwner(repo);

  enforceTrue(
    ownerOfRepo === null,
    apiError(400),
    `${repo} is already the public mirror of ${ownerOfRepo}`,
  );
}
