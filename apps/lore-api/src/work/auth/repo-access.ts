// Whether the person behind a session can open a repository. The list GitHub gave at sign-in answers first; a repo it does not hold is asked of GitHub as it stands now, so a repository created or shared after the sign-in is not refused for the life of the session (ADR-053).

import type {
  RepoAccessPorts,
  RepoPermission,
} from "../../outbound/repo-access-ports.js";
import { repoAllowed } from "./login-grant.js";

/** Who is asking: a person's session with its sign-in list, or a service token, which has no person. */
export interface Asker {
  user: { login: string; repos: string[] } | null;
  tokenHash: string | null;
}

export interface RepoAccess {
  canOpen(principal: Asker, repo: string): Promise<boolean>;
}

/** How long a "no" is believed before GitHub is asked again: long enough that a page listing many repositories asks once, short enough that a new grant shows within minutes. */
export const REFUSAL_TTL_MS = 5 * 60_000;

const OPENS: readonly RepoPermission[] = ["admin", "write", "read"];

export function createRepoAccess(ports: RepoAccessPorts): RepoAccess {
  const refusedUntil = new Map<string, number>();

  return {
    canOpen: async (principal, repo) => {
      if (repoAllowed(principal, repo)) {
        return true;
      }
      const key = `${principal.tokenHash}\n${repo.toLowerCase()}`;

      if ((refusedUntil.get(key) ?? 0) > ports.now()) {
        return false;
      }
      const granted = await askedOfGitHub(ports, principal, repo);

      if (!granted) {
        refusedUntil.set(key, ports.now() + REFUSAL_TTL_MS);
      }

      return granted;
    },
  };
}

/** A person's session and nothing else reaches here. A question GitHub could not answer is a "no": access is never granted on an error. */
async function askedOfGitHub(
  ports: RepoAccessPorts,
  { user, tokenHash }: Asker,
  repo: string,
): Promise<boolean> {
  if (!user || !tokenHash) {
    return false;
  }

  try {
    return await grantedToday(ports, { login: user.login, tokenHash }, repo);
  } catch (err) {
    console.warn(
      `[repo-access] GitHub could not say whether ${user.login} can open ${repo}: ${(err as Error).message}`,
    );

    return false;
  }
}

async function grantedToday(
  ports: RepoAccessPorts,
  session: { login: string; tokenHash: string },
  repo: string,
): Promise<boolean> {
  const granted = OPENS.includes(await ports.permissionOf(session.login, repo));

  if (granted) {
    await ports.remember(session.tokenHash, repo);
  }

  return granted;
}

/** The list from sign-in and nothing more: what a server built without GitHub (a unit test, a route on its own) answers with. */
export const SIGN_IN_LIST_ONLY: RepoAccess = {
  canOpen: async (principal, repo) => repoAllowed(principal, repo),
};
