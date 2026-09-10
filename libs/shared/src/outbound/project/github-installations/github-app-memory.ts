import type { GithubInstallationPayload } from "../../../domain/github-installation/installation-from-github.js";
import type { GithubApp } from "./github-app-port.js";

/** The behavioral spec of {@link GithubApp}: an App whose installations are the payloads it was built with. */
export class InMemoryGithubApp implements GithubApp {
  constructor(private readonly installations: GithubInstallationPayload[]) {}

  async getInstallation(
    installationId: number,
  ): Promise<GithubInstallationPayload | null> {
    return (
      this.installations.find(
        (installation) => installation.id === installationId,
      ) ?? null
    );
  }
}
