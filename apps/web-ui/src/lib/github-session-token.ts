import type { Account } from "next-auth";

/** The GitHub token a session carries. A GitHub App's user token expires (8 hours) and comes with a refresh token; a classic OAuth token carries neither and never expires. */
export interface SessionToken {
  accessToken?: string;
  refreshToken?: string;
  /** Epoch ms. */
  accessTokenExpires?: number;
  /** Set when GitHub refused a refresh: the session has no usable token until its next sign-in. */
  error?: "RefreshAccessTokenError";
}

/** The OAuth app the refresh grant is made for. */
export interface GitHubClient {
  clientId: string;
  clientSecret: string;
}

// What sign-in and GitHub's refresh grant hand back, in next-auth's own token shape.
type SignInAccount = Pick<
  Account,
  "access_token" | "refresh_token" | "expires_at"
>;

type RefreshAnswer = Partial<
  Record<"access_token" | "refresh_token" | "error", string> &
    Record<"expires_in", number>
>;

// Refresh a minute early, so a token never expires between this check and the call it is used for.
const EARLY_MS = 60_000;

const REFRESH_URL = "https://github.com/login/oauth/access_token";

/** What sign-in hands the session: the token, and when the App issued one, how to renew it. */
export function sessionTokenOf(account: SignInAccount): SessionToken {
  return {
    accessToken: account.access_token,
    ...(account.refresh_token ? { refreshToken: account.refresh_token } : {}),
    ...(account.expires_at
      ? { accessTokenExpires: account.expires_at * 1000 }
      : {}),
  };
}

/** True while the session carries a token; a refused refresh counts as signed out, so the person is asked to sign in again. */
export function isSignedIn(token: SessionToken | null): boolean {
  return !!token && !token.error;
}

/** The session's token, renewed through GitHub's refresh grant once it has (nearly) expired. */
export async function freshSessionToken(
  token: SessionToken,
  client: GitHubClient,
  now = Date.now(),
): Promise<SessionToken> {
  const expires = token.accessTokenExpires;

  if (!expires || now < expires - EARLY_MS) {
    return token;
  }

  return refreshed(await refreshGrant(token.refreshToken ?? "", client), now);
}

async function refreshGrant(
  refreshToken: string,
  client: GitHubClient,
): Promise<RefreshAnswer> {
  const res = await fetch(REFRESH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: refreshForm(refreshToken, client),
    signal: AbortSignal.timeout(10_000),
  });

  return res.ok
    ? ((await res.json()) as RefreshAnswer)
    : { error: `HTTP ${res.status}` };
}

function refreshForm(refreshToken: string, client: GitHubClient): string {
  return new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }).toString();
}

// GitHub answers a refused refresh with 200 and an `error` field, so the body decides.
function refreshed(answer: RefreshAnswer, now: number): SessionToken {
  if (answer.error || !answer.access_token) {
    return { error: "RefreshAccessTokenError" };
  }

  return {
    accessToken: answer.access_token,
    refreshToken: answer.refresh_token,
    accessTokenExpires: now + (answer.expires_in ?? 0) * 1000,
  };
}
