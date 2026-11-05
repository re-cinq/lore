// Reads owner/repo from git remote origin and API url/token from git config lore.{api-url,ingest-token}, same as install.sh.

import { execFileSync } from "node:child_process";
import * as path from "node:path";

/** "owner/repo" from the origin remote, or null when not a GitHub-style repo. */
export function detectRepo(cwd: string): string | null {
  const remote = git(["remote", "get-url", "origin"], cwd);

  if (!remote) {
    return null;
  }
  const match = remote.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);

  return match ? match[1] : null;
}

function git(args: string[], cwd?: string): string | null {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** Read a global git config value (e.g. `lore.api-url`), or null. */
export function gitConfigGlobal(key: string): string | null {
  return git(["config", "--global", key]);
}

/** Repo-relative, forward-slashed path for an absolute file, or null if outside the root. */
export function toRepoRelative(root: string, fsPath: string): string | null {
  const rel = path.relative(root, fsPath);

  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }

  return rel.split(path.sep).join("/");
}
