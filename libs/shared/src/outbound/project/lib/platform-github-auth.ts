import type { Octokit } from "octokit";
import { githubHost, githubUrls } from "../../../domain/github-host.js";
import { withoutBlindRetryOnCreates } from "./octokit-retry-policy.js";

/** The Octokit options every client shares: the REST base URL of the configured GitHub host. */
export function octokitOptions(env: NodeJS.ProcessEnv): { baseUrl: string } {
  return { baseUrl: githubUrls(githubHost(env)).api };
}

/** Builds the lazily-imported Octokit client — GitHub App auth when the triple is set, else a plain token. */
export async function buildOctokit(
  env: NodeJS.ProcessEnv,
  extra: { throttle?: { enabled: boolean } } = {},
): Promise<Octokit> {
  const appAuthed = await appOctokit(env);

  if (appAuthed) {
    return appAuthed;
  }
  const token = env.GITHUB_TOKEN;

  if (token) {
    const { Octokit } = await import("octokit");

    return withoutBlindRetryOnCreates(
      new Octokit({ ...octokitOptions(env), ...extra, auth: token }),
    );
  }
  throw new Error(
    "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN",
  );
}

/** Null unless the full GitHub App triple is present in the environment. */
async function appOctokit(env: NodeJS.ProcessEnv): Promise<Octokit | null> {
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  const installationId = env.GITHUB_APP_INSTALLATION_ID;

  if (!appId || !privateKey || !installationId) {
    return null;
  }
  const { Octokit } = await import("octokit");
  const { createAppAuth } = await import("@octokit/auth-app");

  return withoutBlindRetryOnCreates(
    new Octokit({
      ...octokitOptions(env),
      authStrategy: createAppAuth,
      auth: { appId, privateKey, installationId },
    }),
  );
}
