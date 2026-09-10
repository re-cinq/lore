import type { GithubInstallation } from "../../../domain/models/github-installation.js";
import type {
  GithubInstallationsRepository,
  UpsertGithubInstallationInput,
} from "./github-installations-port.js";

/** The behavioral spec of {@link GithubInstallationsRepository}, backed by a Map keyed by installation id. */
export class InMemoryGithubInstallations implements GithubInstallationsRepository {
  private readonly installations = new Map<string, GithubInstallation>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async upsert(
    input: UpsertGithubInstallationInput,
  ): Promise<GithubInstallation> {
    const at = this.now();
    const installation: GithubInstallation = {
      ...input,
      installedAt:
        this.installations.get(input.installationId)?.installedAt ?? at,
      updatedAt: at,
    };

    this.installations.set(input.installationId, installation);

    return installation;
  }

  async findByAccount(
    accountLogin: string,
  ): Promise<GithubInstallation | null> {
    const wanted = accountLogin.toLowerCase();

    return (
      [...this.installations.values()].find(
        (installation) => installation.accountLogin.toLowerCase() === wanted,
      ) ?? null
    );
  }
}
