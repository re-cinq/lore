// Does the signed-in user (their GitHub OAuth token) have access to `repo`?
// Log/timeline proxy routes gate on this so a user can only read runtime data
// for repos they can already see on GitHub. Distinct from lib/github.ts
// `checkRepoAccess`, which asks whether the *App installation* has access.

type FetchLike = typeof fetch;

export async function userCanAccessRepo(
  accessToken: string,
  repo: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    });

    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Does the signed-in user have WRITE (push) access to `repo`? Action routes
 * that start agent runs and push to branches gate on this — read access to a
 * public repo must not be a write trigger. Reads the `permissions` block the
 * repo GET returns for the authenticated caller.
 */
export async function userCanWriteRepo(
  accessToken: string,
  repo: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!res.ok) {
      return false;
    }

    const body = (await res.json()) as {
      permissions?: { push?: boolean; admin?: boolean };
    };

    return body.permissions?.push === true || body.permissions?.admin === true;
  } catch {
    return false;
  }
}
