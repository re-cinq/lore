export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const HANDOFF_TTL_MS = 10 * 60 * 1000;

export type LoginFailure = "not_in_org" | "github_denied" | "state_expired";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Until Lore has roles of its own, a signed-in person can do what the web UI's shared admin token let everyone do: sign-in only checks that they belong to the org. */
export const SESSION_SCOPES = ["admin"];

/** The UI page the person returns to: the configured UI origin, or a local UI over http. */
export function returnUrlAllowed(
  returnUrl: string,
  env: { LORE_UI_URL?: string },
): boolean {
  const target = URL.parse(returnUrl);

  return target !== null && (isConfiguredUi(target, env) || isLocalUi(target));
}

function isConfiguredUi(target: URL, env: { LORE_UI_URL?: string }): boolean {
  const uiOrigin = env.LORE_UI_URL ? URL.parse(env.LORE_UI_URL)?.origin : null;

  return uiOrigin === target.origin;
}

function isLocalUi(target: URL): boolean {
  return target.protocol === "http:" && LOCAL_HOSTS.has(target.hostname);
}

export function authorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const query = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: "read:user read:org repo",
    state: input.state,
  });

  return `https://github.com/login/oauth/authorize?${query}`;
}

export function redeemRedirect(returnUrl: string, code: string): string {
  return withQuery(returnUrl, "code", code);
}

export function errorRedirect(returnUrl: string, reason: LoginFailure): string {
  return withQuery(returnUrl, "auth_error", reason);
}

function withQuery(returnUrl: string, key: string, value: string): string {
  const url = new URL(returnUrl);

  url.searchParams.set(key, value);

  return url.toString();
}

/** Whether a token may open a repo: a person's session only the repos GitHub showed at sign-in, whatever its scope, and any other token every repo. */
export function repoAllowed(
  principal: { user: { repos: string[] } | null },
  repo: string,
): boolean {
  const { user } = principal;

  return user === null || listsRepo(user.repos, repo);
}

function listsRepo(repos: string[], repo: string): boolean {
  const wanted = repo.toLowerCase();

  return repos.some((name) => name.toLowerCase() === wanted);
}
