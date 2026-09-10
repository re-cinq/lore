import type { ApiResult } from "@/lib/api/result";
import type { components } from "@/lib/api/schema";

type GithubInstallation = components["schemas"]["GithubInstallation"];

/** Where the Connect GitHub callback leaves the admin: back on the settings page, or on a message saying why the installation was not recorded. */
export type CallbackOutcome = { redirectTo: string } | { error: string };

/** What the callback does with lore-api's answer to recording an installation (specs/4-ux-repo-onboarding FR-8). */
export function callbackOutcome(
  _recorded: ApiResult<GithubInstallation>,
): CallbackOutcome {
  return { redirectTo: "/settings" };
}
