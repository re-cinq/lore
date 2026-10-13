const REPO_PATH = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/;

/** The canonically-cased redirect target for a `/repos/{owner}/{repo}...` path, or null when it already matches, isn't repo-scoped, or names a repo lore-api doesn't know (left to 404 downstream). */
export function canonicalRepoRedirect(
  pathname: string,
  search: string,
  fullName: string | null,
): string | null {
  const match = REPO_PATH.exec(pathname);

  if (!match || !fullName) {
    return null;
  }

  const [, owner, repo, rest = ""] = match;

  if (`${owner}/${repo}` === fullName) {
    return null;
  }

  return `/repos/${fullName}${rest}${search}`;
}
