// Whether the person behind a session may reach a repository at the level a route declares: every level needs the repository on the sign-in installation list (FR-031), and write and admin then ask GitHub as Lore's App (ADR-053, ADR-054).

import {
  PersonTokenUnavailable,
  type RepoAccessPorts,
  type RepoPermission,
} from "../../outbound/repo-access-ports.js";
import { repoAllowed } from "./login-grant.js";

/** GitHub's permission level on a repository (FR-001). */
export type RepoLevel = "read" | "write" | "admin";

/** Who is asking: a person's session with its sign-in list, or a service token, which has no person. */
export interface Asker {
  user: { login: string; repos: string[] } | null;
  tokenHash: string | null;
}

export interface RepoAccess {
  canOpen(principal: Asker, repo: string, level?: RepoLevel): Promise<boolean>;
}

/** How long a "no" is believed before GitHub is asked again: long enough that a page listing many repositories asks once, short enough that a new grant shows within minutes. */
export const REFUSAL_TTL_MS = 5 * 60_000;

export function createRepoAccess(ports: RepoAccessPorts): RepoAccess {
  return {
    canOpen: async (principal, repo, level = "read") => {
      if (principal.user === null) {
        return true;
      }

      if (level === "read") {
        return repoAllowed(principal, repo);
      }

      return (
        (await hasLevelToday(ports, principal, repo, level)) &&
        repoAllowed(principal, repo)
      );
    },
  };
}

const MEETS_LEVEL: Record<RepoLevel, readonly RepoPermission[]> = {
  read: ["admin", "write", "read"],
  write: ["admin", "write"],
  admin: ["admin"],
};

async function hasLevelToday(
  ports: RepoAccessPorts,
  principal: Asker,
  repo: string,
  level: RepoLevel,
): Promise<boolean> {
  const permission = await askedOfGitHub(ports, principal, repo);

  return MEETS_LEVEL[level].includes(permission);
}

/** A person's session and nothing else reaches here. A question GitHub could not answer is `none`: access is never granted on an error. */
async function askedOfGitHub(
  ports: RepoAccessPorts,
  { user, tokenHash }: Asker,
  repo: string,
): Promise<RepoPermission> {
  if (!user || !tokenHash) {
    return "none";
  }

  try {
    return await ports.permissionOf(user.login, repo, tokenHash);
  } catch (err) {
    if (err instanceof PersonTokenUnavailable) {
      throw err;
    }
    console.warn(
      `[repo-access] GitHub could not say whether ${user.login} can open ${repo}: ${(err as Error).message}`,
    );

    return "none";
  }
}

/** The list from sign-in and nothing more: what a server built without GitHub (a unit test, a route on its own) answers with. */
export const SIGN_IN_LIST_ONLY: RepoAccess = {
  canOpen: async (principal, repo, level = "read") =>
    principal.user === null ||
    (level === "read" && repoAllowed(principal, repo)),
};
