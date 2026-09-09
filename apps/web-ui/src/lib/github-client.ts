/** The GitHub App auth client itself — split out so a route-specific module (workflow-PR installs) can reach it without importing all of github.ts's PR-status logic back. */

import { Octokit } from "octokit";
import { withoutBlindRetryOnCreates } from "./octokit-retry-policy";
import { createAppAuth } from "@octokit/auth-app";

export function split(repo: string): [string, string] {
  const [owner, name] = repo.split("/");

  return [owner, name];
}

function readGithubAppEnv() {
  return {
    appId: process.env.GITHUB_APP_ID ?? "",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY ?? "",
    installationId: process.env.GITHUB_APP_INSTALLATION_ID ?? "",
  };
}

function hasGithubAppCredentials(
  creds: ReturnType<typeof readGithubAppEnv>,
): boolean {
  return (
    Boolean(creds.appId) &&
    Boolean(creds.privateKey) &&
    Boolean(creds.installationId)
  );
}

export async function octokit(): Promise<Octokit> {
  const creds = readGithubAppEnv();

  if (!hasGithubAppCredentials(creds)) {
    throw new Error("GitHub App credentials not configured");
  }

  return withoutBlindRetryOnCreates(
    new Octokit({
      authStrategy: createAppAuth,
      auth: creds,
    }),
  );
}

export function isGitHubConfigured(): boolean {
  return !!(
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_APP_PRIVATE_KEY &&
    process.env.GITHUB_APP_INSTALLATION_ID
  );
}
