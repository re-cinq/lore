import type { Pool } from "pg";
import { Octokit } from "octokit";
import { guardAppClient } from "@re-cinq/lore-shared/project/lib/app-client-guard.js";
import { withoutBlindRetryOnCreates } from "@re-cinq/lore-shared/project/lib/octokit-retry-policy.js";
import { createAppAuth } from "@octokit/auth-app";
import { request } from "@octokit/request";
import { githubHost, githubUrls } from "@re-cinq/lore-shared/github-host.js";
import {
  installationIdFor,
  octokitOptions,
} from "@re-cinq/lore-shared/project/lib/platform-github-auth.js";
import { PgGithubInstallations } from "@re-cinq/lore-shared/project/github-installations/github-installations-pg.js";
import type { GithubInstallationsRepository } from "@re-cinq/lore-shared/project/github-installations/github-installations-port.js";

export type InstallationsSource = Pool | GithubInstallationsRepository;

export interface GitHubAuthScope {
  repo?: string;
  installationId?: string;
  installations?: InstallationsSource;
}

export function isGitHubConfigured(): boolean {
  return isAppConfigured() || Boolean(process.env.GITHUB_TOKEN);
}

export function isAppConfigured(installations?: InstallationsSource): boolean {
  const hasInstallation = Boolean(
    process.env.GITHUB_APP_INSTALLATION_ID ||
    resolveInstallations(installations),
  );

  return hasAppCredentials(process.env) && hasInstallation;
}

/** Authenticated Octokit; prefers per-owner or env App auth, falling back to personal token. */
export async function getOctokit(scope?: GitHubAuthScope): Promise<Octokit> {
  const recorded = await recordedInstallationId(scope, process.env);
  const installationId = recorded ?? process.env.GITHUB_APP_INSTALLATION_ID;

  if (hasAppCredentials(process.env) && installationId) {
    return appAuthOctokit(process.env, installationId);
  }
  const token = process.env.GITHUB_TOKEN;

  if (token) {
    return guardAppClient(
      withoutBlindRetryOnCreates(
        new Octokit({ ...octokitOptions(process.env), auth: token }),
      ),
    );
  }
  throw new Error(
    "GitHub not configured. Set GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID or GITHUB_TOKEN",
  );
}

/** Raw Bearer token for direct fetch calls; resolves per-owner installation before env fallback. */
export async function getGitHubToken(
  scope?: GitHubAuthScope,
): Promise<string | null> {
  const recorded = await recordedInstallationId(scope, process.env);

  if (recorded && hasAppCredentials(process.env)) {
    const { token } = await appAuthFor(
      process.env,
      recorded,
    )({
      type: "installation",
    });

    return token;
  }

  return envFallbackToken(process.env);
}

async function envFallbackToken(
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const installationId = env.GITHUB_APP_INSTALLATION_ID;

  if (hasAppCredentials(env) && installationId) {
    try {
      const { token } = await appAuthFor(
        env,
        installationId,
      )({
        type: "installation",
      });

      return token;
    } catch {
      /* fall through */
    }
  }

  return env.GITHUB_TOKEN || null;
}

async function recordedInstallationId(
  scope: GitHubAuthScope | undefined,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  if (scope?.installationId) {
    return scope.installationId;
  }
  const installations = resolveInstallations(scope?.installations);

  return installationIdFor(installations, scope?.repo, env);
}

let registeredPool: (() => Pool | null) | null = null;

export function setGitHubInstallationsPool(
  getPool: (() => Pool | null) | null,
): void {
  registeredPool = getPool;
}

export function resolveInstallations(
  explicit?: InstallationsSource,
): GithubInstallationsRepository | undefined {
  if (explicit) {
    return "query" in explicit ? new PgGithubInstallations(explicit) : explicit;
  }
  const pool = registeredPool?.();

  return pool ? new PgGithubInstallations(pool) : undefined;
}

function hasAppCredentials(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);
}

const octokits = new Map<string, Octokit>();

function appAuthOctokit(
  env: NodeJS.ProcessEnv,
  installationId: string,
): Octokit {
  const key = authCacheKey(env, installationId);
  const existing = octokits.get(key);

  if (existing) {
    return existing;
  }
  const client = buildAppOctokit(env, installationId);

  octokits.set(key, client);

  return client;
}

function buildAppOctokit(
  env: NodeJS.ProcessEnv,
  installationId: string,
): Octokit {
  return guardAppClient(
    withoutBlindRetryOnCreates(
      new Octokit({
        ...octokitOptions(env),
        authStrategy: createAppAuth,
        auth: {
          appId: env.GITHUB_APP_ID ?? "",
          privateKey: env.GITHUB_APP_PRIVATE_KEY ?? "",
          installationId,
        },
      }),
    ),
  );
}

const appAuths = new Map<string, ReturnType<typeof createAppAuth>>();

/** One App auth per installation: it caches the installation token and renews it before it expires, so a read does not start by asking GitHub for a new one. */
function appAuthFor(
  env: NodeJS.ProcessEnv,
  installationId: string,
): ReturnType<typeof createAppAuth> {
  const key = authCacheKey(env, installationId);
  const existing = appAuths.get(key);

  if (existing) {
    return existing;
  }
  const created = createAppAuth(appAuthOptions(env, installationId));

  appAuths.set(key, created);

  return created;
}

function authCacheKey(env: NodeJS.ProcessEnv, installationId: string): string {
  return [
    env.GITHUB_APP_ID ?? "",
    githubHost(env),
    installationId,
    env.GITHUB_APP_PRIVATE_KEY ?? "",
  ].join("|");
}

/** What a standalone App auth needs: it does not inherit an Octokit base URL, so its request is pointed at the configured GitHub host. */
export function appAuthOptions(
  env: NodeJS.ProcessEnv,
  installationId: string = env.GITHUB_APP_INSTALLATION_ID ?? "",
) {
  return {
    appId: env.GITHUB_APP_ID ?? "",
    privateKey: env.GITHUB_APP_PRIVATE_KEY ?? "",
    installationId,
    request: request.defaults({ baseUrl: githubUrls(githubHost(env)).api }),
  };
}

export function githubApiUrl(path: string, env: NodeJS.ProcessEnv): string {
  return `${githubUrls(githubHost(env)).api}${path}`;
}
