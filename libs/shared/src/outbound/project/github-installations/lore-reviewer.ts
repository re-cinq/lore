// The lore-reviewer GitHub App (specs/protected-branch-merge): a second App whose only job is to approve. GitHub refuses an approval from the account that opened a pull request, and Lore's own App opens the implementation loop's, onboarding's and spec upkeep's, so the auto-merge loop approves those as lore-reviewer.
import { PlatformGitHub } from "../lib/platform-github.js";

/** A GitHub client authenticated as lore-reviewer, or null where its three LORE_REVIEWER_APP_* values are not all set. */
export function loreReviewerGitHub(
  env: NodeJS.ProcessEnv = process.env,
): PlatformGitHub | null {
  const {
    LORE_REVIEWER_APP_ID: appId,
    LORE_REVIEWER_APP_PRIVATE_KEY: privateKey,
    LORE_REVIEWER_APP_INSTALLATION_ID: installationId,
  } = env;

  if (!appId || !privateKey || !installationId) {
    return null;
  }

  return new PlatformGitHub({
    GITHUB_APP_ID: appId,
    GITHUB_APP_PRIVATE_KEY: privateKey,
    GITHUB_APP_INSTALLATION_ID: installationId,
  });
}
