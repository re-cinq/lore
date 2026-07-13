/**
 * Resolve the coordinates the extension needs from the developer's machine —
 * the same places install.sh / the MCP server read them, so no extra setup:
 *   - owner/repo from `git remote get-url origin` (mirrors mcp-server's
 *     repo-detect regex)
 *   - API url + token from `git config --global lore.{api-url,ingest-token}`
 */

import { execFileSync } from "node:child_process";

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

/** "owner/repo" from the origin remote, or null when not a GitHub-style repo. */
export function detectRepo(cwd: string): string | null {
  const remote = git(["remote", "get-url", "origin"], cwd);
  if (!remote) return null;
  const match = remote.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

/** Read a global git config value (e.g. `lore.api-url`), or null. */
export function gitConfigGlobal(key: string): string | null {
  return git(["config", "--global", key]);
}
