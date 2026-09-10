import type { ApiResult } from "@/lib/api/result";
import type { components } from "@/lib/api/schema";

type GithubInstallation = components["schemas"]["GithubInstallation"];

/** Where the Connect GitHub callback leaves the admin: back on the settings page, or on a message saying why the installation was not recorded. */
export type CallbackOutcome = { redirectTo: string } | { error: string };

/** What the callback does with lore-api's answer to recording an installation (specs/4-ux-repo-onboarding FR-8). A 404 is lore-api saying GitHub does not know the id as one of this App's installations. */
export function callbackOutcome(
  recorded: ApiResult<GithubInstallation>,
): CallbackOutcome {
  if (recorded.status === "error" && recorded.code === 404) {
    return {
      error:
        "GitHub does not know that installation as one of this App's, so nothing was recorded.",
    };
  }

  return { redirectTo: "/settings" };
}
