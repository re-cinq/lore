import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
// GitHub as one signed-in person: the OAuth code exchange and the reads that decide who they are and what they can open. Each takes the fetch to use, so a test never reaches GitHub.

import { githubHost, githubUrls } from "@re-cinq/lore-shared/github-host.js";

type FetchLike = typeof fetch;

export type OrgRole = "admin" | "member";

export interface OAuthExchange {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}

export interface GithubTokenPair {
  accessToken: string;
  expiresIn?: number;
  refreshToken?: string;
  refreshTokenExpiresIn?: number;
}

export interface GithubViewer {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

export interface GithubRepo {
  full_name: string;
  owner: { login: string };
}

const REPOS_QUERY =
  "per_page=100&affiliation=owner,collaborator,organization_member";
const MAX_REPO_PAGES = 10;
const TIMEOUT_MS = 10_000;

const userHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
});

export function exchangeCode(
  exchange: OAuthExchange,
  fetchImpl: FetchLike = fetch,
  host: string = githubHost(),
): Promise<GithubTokenPair | null> {
  return postTokenRequest(
    {
      client_id: exchange.clientId,
      client_secret: exchange.clientSecret,
      code: exchange.code,
      redirect_uri: exchange.redirectUri,
    },
    fetchImpl,
    host,
  );
}

export interface TokenRefresh {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** GitHub's answer to a refresh token: a new pair, or null when it gave none. */
export function refreshUserToken(
  refresh: TokenRefresh,
  fetchImpl: FetchLike = fetch,
  host: string = githubHost(),
): Promise<GithubTokenPair | null> {
  return postTokenRequest(
    {
      client_id: refresh.clientId,
      client_secret: refresh.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refresh.refreshToken,
    },
    fetchImpl,
    host,
  );
}

async function postTokenRequest(
  body: Record<string, string>,
  fetchImpl: FetchLike,
  host: string,
): Promise<GithubTokenPair | null> {
  const res = await fetchImpl(githubUrls(host).oauthToken, {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  return tokenPairOrWarn(res.status, res.ok ? await res.json() : null);
}

/** The token pair GitHub answered, or null with a log line naming GitHub's error. */
function tokenPairOrWarn(
  status: number,
  body: unknown,
): GithubTokenPair | null {
  const pair = tokenPairOf(body);

  if (!pair) {
    console.warn(
      `[auth] GitHub gave no token for the sign-in code: status ${status}, error ${String(asRecord(body)?.error ?? "none")}`,
    );
  }

  return pair;
}

export async function fetchViewer(
  token: string,
  fetchImpl: FetchLike = fetch,
  host: string = githubHost(),
): Promise<GithubViewer | null> {
  const res = await getJson(`${githubUrls(host).api}/user`, token, fetchImpl);

  if (!res.ok) {
    console.warn(`[auth] GitHub refused /user: status ${res.status}`);
  }

  return res.ok ? viewerOf(await res.json()) : null;
}

/** GitHub refused the membership question for want of permission: a fault of the install, not an answer about the person (FR-043, FR-142). */
export class MembershipPermissionRefused extends Error {
  constructor(org: string) {
    super(`GitHub refused the membership question for ${org} (403)`);
    this.name = "MembershipPermissionRefused";
  }
}

/** The person's role in the org, or null when they are not an active member. Throws MembershipPermissionRefused when GitHub answers 403. */
export async function fetchOrgRole(
  token: string,
  org: string,
  fetchImpl: FetchLike = fetch,
  host: string = githubHost(),
): Promise<OrgRole | null> {
  const res = await getJson(
    `${githubUrls(host).api}/user/memberships/orgs/${org}`,
    token,
    fetchImpl,
  );

  enforceTrue(res.status !== 403, MembershipPermissionRefused, org);

  return res.ok ? activeRoleOf(await res.json()) : null;
}

/** Every repo the person can open, up to ten pages; a failing page ends the read with what came before. */
export function fetchUserRepos(
  token: string,
  fetchImpl: FetchLike = fetch,
  host: string = githubHost(),
): Promise<GithubRepo[]> {
  return reposFrom(
    `${githubUrls(host).api}/user/repos?${REPOS_QUERY}`,
    token,
    fetchImpl,
    MAX_REPO_PAGES,
  );
}

/** Every repo of the installation the person can open, read to its last page; a failing page throws so no partial list is ever taken for the whole. */
export async function fetchInstallationRepos(
  token: string,
  installationId: string,
  fetchImpl: FetchLike = fetch,
  host: string = githubHost(),
): Promise<GithubRepo[]> {
  const repos: GithubRepo[] = [];
  let url: string | null =
    `${githubUrls(host).api}/user/installations/${encodeURIComponent(installationId)}/repositories?per_page=100`;

  while (url) {
    const res = await getJson(url, token, fetchImpl);

    if (!res.ok) {
      throw new Error(`GitHub answered ${res.status} for ${url}`);
    }
    const body = (await res.json()) as { repositories?: GithubRepo[] };

    repos.push(...(body.repositories ?? []));
    url = nextPageUrl(res.headers.get("link"));
  }

  return repos;
}

async function reposFrom(
  url: string | null,
  token: string,
  fetchImpl: FetchLike,
  pagesLeft: number,
): Promise<GithubRepo[]> {
  const page =
    url && pagesLeft > 0 ? await readRepoPage(url, token, fetchImpl) : null;

  if (!page) {
    return [];
  }
  const rest = await reposFrom(page.next, token, fetchImpl, pagesLeft - 1);

  return [...page.repos, ...rest];
}

async function readRepoPage(url: string, token: string, fetchImpl: FetchLike) {
  const res = await getJson(url, token, fetchImpl);

  return res.ok
    ? {
        repos: (await res.json()) as GithubRepo[],
        next: nextPageUrl(res.headers.get("link")),
      }
    : null;
}

function getJson(url: string, token: string, fetchImpl: FetchLike) {
  return fetchImpl(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: userHeaders(token),
  });
}

function tokenPairOf(body: unknown): GithubTokenPair | null {
  const record = asRecord(body);

  if (!record || !isNonEmptyString(record.access_token)) {
    return null;
  }

  return {
    accessToken: record.access_token,
    ...optionalTokenFields(record),
  };
}

function optionalTokenFields(
  record: Record<string, unknown>,
): Omit<GithubTokenPair, "accessToken"> {
  return {
    ...(typeof record.expires_in === "number" && {
      expiresIn: record.expires_in,
    }),
    ...(typeof record.refresh_token === "string" && {
      refreshToken: record.refresh_token,
    }),
    ...(typeof record.refresh_token_expires_in === "number" && {
      refreshTokenExpiresIn: record.refresh_token_expires_in,
    }),
  };
}

function viewerOf(body: unknown): GithubViewer | null {
  const record = asRecord(body);

  if (!record || !isNonEmptyString(record.login) || !isGithubId(record.id)) {
    return null;
  }

  return {
    id: record.id,
    login: record.login,
    name: typeof record.name === "string" ? record.name : null,
    avatar_url: typeof record.avatar_url === "string" ? record.avatar_url : "",
  };
}

function isGithubId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function activeRoleOf(body: { state?: string; role?: string }): OrgRole | null {
  if (body.state !== "active") {
    return null;
  }

  return body.role === "admin" ? "admin" : "member";
}

function nextPageUrl(linkHeader: string | null): string | null {
  return /<([^>]+)>;\s*rel="next"/.exec(linkHeader ?? "")?.[1] ?? null;
}
