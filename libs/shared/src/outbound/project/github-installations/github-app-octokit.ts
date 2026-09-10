import type { Octokit } from "octokit";
import type { GithubInstallationPayload } from "../../../domain/github-installation/installation-from-github.js";
import type { GithubApp } from "./github-app-port.js";

/** The App's own identity: its id and private key, with no installation pinned — which is what lets it ask about any installation of this App. */
export interface GithubAppCredentials {
  appId: string;
  privateKey: string;
}

/** {@link GithubApp} over GitHub's REST API (`GET /app/installations/{id}`), authenticated as the App itself. GitHub's 404 means the id is not an installation of this App, so it is answered as null; every other failure propagates. */
export class OctokitGithubApp implements GithubApp {
  constructor(private readonly credentials: GithubAppCredentials) {}

  async getInstallation(
    installationId: number,
  ): Promise<GithubInstallationPayload | null> {
    const { apps } = (await appOctokit(this.credentials)).rest;

    try {
      const { data: installation } = await apps.getInstallation({
        installation_id: installationId,
      });

      return payloadOf(installation);
    } catch (err) {
      if ((err as { status?: number }).status === 404) {
        return null;
      }
      throw err;
    }
  }
}

/** Octokit authenticated as the App (a JWT from its key), loaded lazily like the rest of the GitHub adapters. */
async function appOctokit(credentials: GithubAppCredentials): Promise<Octokit> {
  const { Octokit } = await import("octokit");
  const { createAppAuth } = await import("@octokit/auth-app");

  return new Octokit({ authStrategy: createAppAuth, auth: credentials });
}

/** The fields Lore records. An account without a login or type (an enterprise installation) comes through empty, so the mapper's enum parse refuses it loudly rather than recording a guess. */
function payloadOf(installation: {
  id: number;
  account: unknown;
  repository_selection: string;
  suspended_at: string | null;
}): GithubInstallationPayload {
  const account = (installation.account ?? {}) as {
    login?: string;
    type?: string;
  };

  return {
    id: installation.id,
    account: { login: account.login ?? "", type: account.type ?? "" },
    repository_selection: installation.repository_selection,
    suspended_at: installation.suspended_at,
  };
}
