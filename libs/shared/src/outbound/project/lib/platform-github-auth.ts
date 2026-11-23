import type { Octokit } from "octokit";
import { githubHost, githubUrls } from "../../../domain/github-host.js";
import type { GithubInstallationsRepository } from "../github-installations/github-installations-port.js";
import { guardAppClient } from "./app-client-guard.js";
import { withoutBlindRetryOnCreates } from "./octokit-retry-policy.js";

/** The Octokit options every client shares: the REST base URL of the configured GitHub host. */
export function octokitOptions(env: NodeJS.ProcessEnv): { baseUrl: string } {
  return { baseUrl: githubUrls(githubHost(env)).api };
}

/** The installation recorded for the repo's owner (owner of owner/name, matched case-insensitively by the registry); undefined when there is no registry, no repo or no row, so the caller falls back to GITHUB_APP_INSTALLATION_ID. */
export async function installationIdFor(
  installations: GithubInstallationsRepository | undefined,
  repo: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const owner = repo?.split("/")[0];

  if (!installations || !owner || !env.GITHUB_APP_ID) {
    return undefined;
  }

  return (await installations.findByAccount(owner))?.installationId;
}

/** Builds the lazily-imported Octokit client — GitHub App auth when the triple is set, else a plain token. */
export async function buildOctokit(
  env: NodeJS.ProcessEnv,
  extra: { throttle?: { enabled: boolean } } = {},
  installationId?: string,
): Promise<Octokit> {
  const appAuthed = await appOctokit(env, installationId);

  return appAuthed ?? tokenOctokit(env, extra);
}

async function tokenOctokit(
  env: NodeJS.ProcessEnv,
  extra: { throttle?: { enabled: boolean } },
): Promise<Octokit> {
  const token = env.GITHUB_TOKEN;

  if (token) {
    const { Octokit } = await import("octokit");

    const client = withoutBlindRetryOnCreates(
      new Octokit({ ...octokitOptions(env), ...extra, auth: token }),
    );

    // The process's own token is the service's; any other env is a caller's own credential.
    return env === process.env ? guardAppClient(client) : client;
  }
  throw new Error(
    "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN",
  );
}

/** Null unless the full GitHub App triple is present: the recorded installation wins over the environment's. */
async function appOctokit(
  env: NodeJS.ProcessEnv,
  recordedInstallationId?: string,
): Promise<Octokit | null> {
  const { GITHUB_APP_ID: appId, GITHUB_APP_PRIVATE_KEY: privateKey } = env;
  const installationId =
    recordedInstallationId ?? env.GITHUB_APP_INSTALLATION_ID;

  if (!appId || !privateKey || !installationId) {
    return null;
  }

  return appClient(env, { appId, privateKey, installationId });
}

async function appClient(
  env: NodeJS.ProcessEnv,
  auth: { appId: string; privateKey: string; installationId: string },
): Promise<Octokit> {
  const { Octokit } = await import("octokit");
  const { createAppAuth } = await import("@octokit/auth-app");

  return guardAppClient(
    withoutBlindRetryOnCreates(
      new Octokit({
        ...octokitOptions(env),
        authStrategy: createAppAuth,
        auth,
      }),
    ),
  );
}
