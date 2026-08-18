// Does the signed-in user (their GitHub OAuth token) have access to `repo`?
// Log/timeline proxy routes gate on this so a user can only read runtime data
// for repos they can already see on GitHub. Distinct from lib/github.ts
// `checkRepoAccess`, which asks whether the *App installation* has access.

type FetchLike = typeof fetch;

/** Why GitHub said no, in the terms an operator can act on. The three cases are
 *  materially different and the caller sees one flat "Access denied" for all of
 *  them, so the distinction has to survive here or it is lost. */
function denialReason(status: number): string {
  if (status === 404) {
    return "a 404 here usually means the OAuth app has no access to the org, not that the repo is missing";
  }

  if (status === 401) {
    return "the session's token is stale or revoked — signing out and back in mints a new one";
  }

  if (status === 403) {
    return "rate-limited or blocked by the org's OAuth app policy";
  }

  return "unexpected status";
}

export async function userCanAccessRepo(
  accessToken: string,
  repo: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}`, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!res.ok) {
      // Never the token, only the repo and the status.
      console.warn(
        `[repo-access] denied ${repo}: GitHub answered ${res.status} (${denialReason(res.status)})`,
      );
    }

    return res.ok;
  } catch (err) {
    console.warn(
      `[repo-access] denied ${repo}: could not reach GitHub — ${err instanceof Error ? err.message : String(err)}`,
    );

    return false;
  }
}
