import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

export type GithubInstallation = components["schemas"]["GithubInstallation"];

/** The GitHub accounts Lore is connected to (specs/4-ux-repo-onboarding FR-8), ordered by account login. */
export function listGithubInstallations(): Promise<
  ApiResult<GithubInstallation[]>
> {
  return apiFetch("lore-api", "/api/github/installations");
}
