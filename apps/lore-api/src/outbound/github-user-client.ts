// GitHub as one signed-in person: the OAuth code exchange and the reads that decide who they are and what they can open. Each takes the fetch to use, so a test never reaches GitHub.

type FetchLike = typeof fetch;

export type OrgRole = "admin" | "member";

export interface OAuthExchange {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}

export interface GithubViewer {
  login: string;
  name: string | null;
  avatar_url: string;
}

export interface GithubRepo {
  full_name: string;
  owner: { login: string };
}

const API = "https://api.github.com";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const REPOS_URL = `${API}/user/repos?per_page=100&affiliation=owner,collaborator,organization_member`;
const MAX_REPO_PAGES = 10;
const TIMEOUT_MS = 10_000;

const userHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
});

export async function exchangeCode(
  exchange: OAuthExchange,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: exchange.clientId,
      client_secret: exchange.clientSecret,
      code: exchange.code,
      redirect_uri: exchange.redirectUri,
    }),
  });

  return res.ok ? accessTokenOf(await res.json()) : null;
}

export async function fetchViewer(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<GithubViewer | null> {
  const res = await getJson(`${API}/user`, token, fetchImpl);

  return res.ok ? ((await res.json()) as GithubViewer) : null;
}

/** The person's role in the org, or null when they are not an active member. */
export async function fetchOrgRole(
  token: string,
  org: string,
  fetchImpl: FetchLike = fetch,
): Promise<OrgRole | null> {
  const res = await getJson(
    `${API}/user/memberships/orgs/${org}`,
    token,
    fetchImpl,
  );

  return res.ok ? activeRoleOf(await res.json()) : null;
}

/** Every repo the person can open, up to ten pages; a failing page ends the read with what came before. */
export function fetchUserRepos(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<GithubRepo[]> {
  return reposFrom(REPOS_URL, token, fetchImpl, MAX_REPO_PAGES);
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

function accessTokenOf(body: { access_token?: string }): string | null {
  return body.access_token ?? null;
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
