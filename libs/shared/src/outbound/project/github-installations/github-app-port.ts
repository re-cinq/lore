import type { GithubInstallationPayload } from "../../../domain/github-installation/installation-from-github.js";

/** GitHub, as the App itself sees it (authenticated with the App's own key, no installation pinned): the one question the Connect GitHub flow asks before recording an installation — is this id really an installation of this App? */
export interface GithubApp {
  /** The installation GitHub knows under this id, or null when it is not an installation of this App. */
  getInstallation(
    installationId: number,
  ): Promise<GithubInstallationPayload | null>;
}
