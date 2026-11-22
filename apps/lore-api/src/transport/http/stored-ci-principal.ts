// Resolves a stored repository CI token row (`kind: 'ci'`) to its repository-bound principal via `lore.repos.github_id` (FR-078).

import type { Pool } from "pg";
import type { Principal } from "./auth.js";

// A stored CI token follows its repository's numeric id across renames; unbound, unmatched or ambiguous ids resolve to no principal (FR-078).
export async function storedCiPrincipal(
  pool: Pool,
  githubRepoId: string | null | undefined,
  tokenHash: string,
): Promise<Principal | null> {
  if (!githubRepoId) {
    return null;
  }
  const repo = await onlyRepoWithId(pool, githubRepoId);

  if (!repo) {
    return null;
  }

  return storedCiOf(repo, tokenHash);
}

function storedCiOf(
  repo: { full_name: string; default_branch: string | null },
  tokenHash: string,
): Principal {
  return {
    scopes: ["write"],
    user: null,
    tokenHash,
    ciIdentity: {
      repository: repo.full_name,
      ref: "",
      defaultBranch: repo.default_branch ?? "main",
      stored: true,
    },
  };
}

async function onlyRepoWithId(pool: Pool, githubId: string) {
  const { rows } = await pool.query<{
    full_name: string;
    default_branch: string | null;
  }>("SELECT full_name, default_branch FROM lore.repos WHERE github_id = $1", [
    githubId,
  ]);

  return rows.length === 1 ? rows[0] : null;
}
