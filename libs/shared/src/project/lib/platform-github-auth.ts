import type { Octokit } from "octokit";
import { withoutBlindRetryOnCreates } from "./octokit-retry-policy.js";

/** Builds the lazily-imported Octokit client — GitHub App auth when the triple is set, else a plain token. */
export async function buildOctokit(env: NodeJS.ProcessEnv): Promise<Octokit> {
  const { Octokit } = await import("octokit");
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  const installationId = env.GITHUB_APP_INSTALLATION_ID;

  if (appId && privateKey && installationId) {
    const { createAppAuth } = await import("@octokit/auth-app");

    return withoutBlindRetryOnCreates(
      new Octokit({
        authStrategy: createAppAuth,
        auth: { appId, privateKey, installationId },
      }),
    );
  }
  const token = env.GITHUB_TOKEN;

  if (token) {
    return withoutBlindRetryOnCreates(new Octokit({ auth: token }));
  }
  throw new Error(
    "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN",
  );
}
