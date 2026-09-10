import type { ApiResult } from "@/lib/api/result";
import type { components } from "@/lib/api/schema";

type GithubInstallation = components["schemas"]["GithubInstallation"];

type RecordingResult = ApiResult<GithubInstallation>;

/** Where the Connect GitHub callback leaves the admin: back on the settings page, or on a message saying why the installation was not recorded. */
export type CallbackOutcome = { redirectTo: string } | { error: string };

/** What the callback does with lore-api's answer to recording an installation (specs/4-ux-repo-onboarding FR-8): only a recorded installation returns to settings; every failure is explained. */
export function callbackOutcome(recorded: RecordingResult): CallbackOutcome {
  if (recorded.status === "ok") {
    return { redirectTo: "/settings" };
  }

  return { error: failureReason(recorded) };
}

/** Why the installation was not recorded, in words the admin can act on. A 404 is lore-api saying GitHub does not know the id as one of this App's installations. */
function failureReason(
  recorded: Exclude<RecordingResult, { status: "ok" }>,
): string {
  if (recorded.status === "unconfigured") {
    return "The web UI cannot reach lore-api, so the installation was not recorded.";
  }

  return recorded.code === 404
    ? "GitHub does not know that installation as one of this App's, so nothing was recorded."
    : `Recording the installation failed: ${recorded.message}`;
}
