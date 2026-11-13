import { execSync } from "node:child_process";

let cachedRepo: string | null | undefined = undefined;

export function detectCurrentRepo(): string | null {
  if (cachedRepo !== undefined) {
    return cachedRepo;
  }

  try {
    const remote = execSync("git remote get-url origin", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    // Parse SSH or HTTPS remote URLs to extract owner/repo.
    const match = remote.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);

    cachedRepo = match ? match[1] : null;
  } catch {
    cachedRepo = null;
  }

  return cachedRepo;
}

export function resetRepoCache(): void {
  cachedRepo = undefined;
}

/** What git prints for a detached HEAD: no branch, so nothing CI could have judged under a name. */
const DETACHED = "HEAD";

/** The checked-out branch, or null when detached or outside a checkout. Never cached: a session switches branches, and a CI question is about the one it is on NOW. */
export function detectCurrentBranch(): string | null {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    return branch === DETACHED || branch === "" ? null : branch;
  } catch {
    return null;
  }
}
