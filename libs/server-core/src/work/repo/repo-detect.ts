import { execSync } from "node:child_process";

let cachedRepo: string | null = null;

export function detectCurrentRepo(): string | null {
  if (cachedRepo) {
    return cachedRepo;
  }

  try {
    const remote = execSync("git remote get-url origin", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    // Parse SSH or HTTPS remote URLs to extract owner/repo.
    const match = remote.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);

    if (match) {
      cachedRepo = match[1];

      return cachedRepo;
    }
  } catch {
    // ignore; treat as not detected
  }

  return null;
}

export function resetRepoCache(): void {
  cachedRepo = null;
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
