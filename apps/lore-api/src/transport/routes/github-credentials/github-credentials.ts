import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { verifyRunCredential } from "@re-cinq/lore-shared/github-credential/run-credential.js";

/** What the broker needs: the station-run store, the signing key, a clock, and the minter that turns a repo into a fresh GitHub token. */
export interface GitCredentialDeps {
  runs: Pick<AssemblyRunsPort, "findStationRunById">;
  key: string;
  now: () => Date;
  mint: (repo: string) => Promise<string>;
}

/** The answer in the git credential-helper shape: GitHub accepts an installation token as the password for `x-access-token`. */
export type GitCredentialResult =
  | { code: 200; body: { username: string; password: string } }
  | { code: 401; body: { error: string } };

export async function handleGitCredential(
  deps: GitCredentialDeps,
  credential: string,
  body: { repo: string },
): Promise<GitCredentialResult> {
  const verdict = verifyRunCredential(credential, deps.key, deps.now());

  if (!verdict.ok) {
    return { code: 401, body: { error: verdict.reason } };
  }

  return {
    code: 200,
    body: { username: "x-access-token", password: await deps.mint(body.repo) },
  };
}
