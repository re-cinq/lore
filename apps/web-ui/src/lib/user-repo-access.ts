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
