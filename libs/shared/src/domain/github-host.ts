import { enforceTrue } from "../lib/enforce.js";

export const DEFAULT_GITHUB_HOST = "github.com";

export interface GithubUrls {
  web: string;
  api: string;
  oauthAuthorize: string;
  oauthToken: string;
}

const BARE_HOST = /^[^\s/:]+(:\d+)?$/;

// eslint-disable-next-line re-lint/no-duplicate-code -- web-ui does not import lore-shared, so its host helpers are a copy of this module
export function githubHost(env: NodeJS.ProcessEnv = process.env): string {
  const trimmed = env.GITHUB_HOST?.trim();
  const configured = trimmed?.toLowerCase();

  if (!configured) {
    return DEFAULT_GITHUB_HOST;
  }

  enforceTrue(
    BARE_HOST.test(configured),
    Error,
    `GITHUB_HOST must be a bare host name, got "${env.GITHUB_HOST}"`,
  );

  return configured;
}

export function githubUrls(host: string = githubHost()): GithubUrls {
  const web = `https://${host}`;

  return {
    web,
    api:
      host === DEFAULT_GITHUB_HOST ? "https://api.github.com" : `${web}/api/v3`,
    oauthAuthorize: `${web}/login/oauth/authorize`,
    oauthToken: `${web}/login/oauth/access_token`,
  };
}

export function githubHostPattern(host: string = githubHost()): string {
  return host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function githubIssueUrl(
  repo: string,
  number: number | string,
  host: string = githubHost(),
): string {
  return `${githubUrls(host).web}/${repo}/issues/${number}`;
}

export function githubPullUrl(
  repo: string,
  number: number | string,
  host: string = githubHost(),
): string {
  return `${githubUrls(host).web}/${repo}/pull/${number}`;
}
