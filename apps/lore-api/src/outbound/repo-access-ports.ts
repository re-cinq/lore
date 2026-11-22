// The two things repo access needs from outside: GitHub's word on a person's permission, asked as Lore's App, and the session row that remembers a repo once it was granted.

import type { Pool } from "pg";
import { buildOctokit } from "@re-cinq/lore-shared/project/lib/platform-github-auth.js";

/** GitHub's legacy base roles: `maintain` reads as write and `triage` as read. */
export type RepoPermission = "admin" | "write" | "read" | "none";

export interface RepoAccessPorts {
  /** What GitHub says the person may do in the repo today, asked with Lore's own App. */
  permissionOf(login: string, repo: string): Promise<RepoPermission>;
  /** Adds the repo to the session's list, so the next question needs no call to GitHub. */
  remember(tokenHash: string, repo: string): Promise<void>;
  now(): number;
}

const PERMISSIONS: readonly RepoPermission[] = [
  "admin",
  "write",
  "read",
  "none",
];

export function repoAccessPorts(
  getPool: () => Pool | null,
  env: NodeJS.ProcessEnv = process.env,
): RepoAccessPorts {
  return {
    permissionOf: (login, repo) =>
      permissionOnGitHub(env, login, repo).catch(noneWhenUnknown),
    remember: (tokenHash, repo) => rememberRepo(getPool(), tokenHash, repo),
    now: Date.now,
  };
}

/** `GET /repos/{owner}/{repo}/collaborators/{username}/permission` with the installation's token (Metadata: read). An answer that is not one of GitHub's four roles is `none`. */
async function permissionOnGitHub(
  env: NodeJS.ProcessEnv,
  login: string,
  repo: string,
): Promise<RepoPermission> {
  const parsed = ownerAndNameOf(repo);

  if (!parsed) {
    return "none";
  }
  const { repos } = (await buildOctokit(env)).rest;
  const { data: level } = await repos.getCollaboratorPermissionLevel({
    owner: parsed.owner,
    repo: parsed.name,
    username: login,
  });

  return PERMISSIONS.find((known) => known === level.permission) ?? "none";
}

const REPO_NAME_FORMAT = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const DOT_SEGMENTS = new Set([".", ".."]);

function ownerAndNameOf(repo: string): { owner: string; name: string } | null {
  if (!REPO_NAME_FORMAT.test(repo)) {
    return null;
  }
  const [owner, name] = repo.split("/");

  return DOT_SEGMENTS.has(owner) || DOT_SEGMENTS.has(name)
    ? null
    : { owner, name };
}

/** A repo or person GitHub does not know is `none`; any other failure is the caller's to refuse on. */
function noneWhenUnknown(err: unknown): RepoPermission {
  if ((err as { status?: number }).status === 404) {
    return "none";
  }
  throw err;
}

async function rememberRepo(
  pool: Pool | null,
  tokenHash: string,
  repo: string,
): Promise<void> {
  await pool?.query(
    `UPDATE pipeline.api_tokens SET repos = array_append(repos, $2)
       WHERE token_hash = $1 AND kind = 'user'
         AND NOT (lower($2) = ANY (SELECT lower(known) FROM unnest(repos) AS known))`,
    [tokenHash, repo],
  );
}
