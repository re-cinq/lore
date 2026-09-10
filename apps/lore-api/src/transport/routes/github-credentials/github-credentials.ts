import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { extractBearer } from "@re-cinq/lore-shared/http/bearer.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import {
  verifyRunCredential,
  type RunCredentialClaims,
} from "@re-cinq/lore-shared/github-credential/run-credential.js";
import {
  decideGitCredential,
  type GitCredentialDecision,
} from "@re-cinq/lore-shared/github-credential/grant.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";
import { runCredentialKey } from "../../../work/github-credential/run-credential-key.js";

const GitCredentialBody = z.object({ repo: z.string().min(1) });

const GitCredentialPair = z.object({
  username: z.string(),
  password: z.string(),
});

/** The git-credential broker (ADR-031 amendment 2026-09-10): an agent pod's credential helper trades its run credential for a token scoped to its repo, minted now. The run credential in `Authorization: Bearer` is the auth, so no bearer scope applies. */
export function githubCredentialsRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/github-credentials",
    options: zodResponse(
      { auth: false, validate: { payload: zodValidate(GitCredentialBody) } },
      GitCredentialPair,
      {
        name: "GitCredential",
        description:
          "A freshly minted installation token for the run's repo, as the git credential-helper username/password pair",
        errors: [401, 403],
      },
    ),
    handler: withPool(getPool, serveGitCredential),
  };
}

async function serveGitCredential(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const github = new PlatformGitHub(process.env);
  const result = await handleGitCredential(
    {
      runs: new PgAssemblyRuns(pool),
      key: runCredentialKey(process.env),
      now: () => new Date(),
      mint: (repo) => github.getInstallationToken(repo),
    },
    extractBearer(request.headers.authorization) ?? "",
    request.payload as z.infer<typeof GitCredentialBody>,
  );

  return h.response(result.body).code(result.code);
}

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
  | { code: 401 | 403; body: { error: string } };

export async function handleGitCredential(
  deps: GitCredentialDeps,
  credential: string,
  body: { repo: string },
): Promise<GitCredentialResult> {
  const verdict = verifyRunCredential(credential, deps.key, deps.now());

  if (!verdict.ok) {
    return { code: 401, body: { error: verdict.reason } };
  }
  const decision = await decideForRun(deps, verdict.claims, body.repo);

  if (!decision.grant) {
    return { code: 403, body: { error: decision.reason } };
  }

  return { code: 200, body: credentialPair(await deps.mint(decision.repo)) };
}

/** GitHub accepts an installation token as the password of the `x-access-token` user. */
function credentialPair(token: string): { username: string; password: string } {
  return { username: "x-access-token", password: token };
}

/** The grant decision for the run the claims name; a run the store no longer has is treated as closed. */
async function decideForRun(
  deps: GitCredentialDeps,
  claims: RunCredentialClaims,
  repo: string,
): Promise<GitCredentialDecision> {
  const stationRun = await deps.runs.findStationRunById(claims.stationRunId);

  return stationRun
    ? decideGitCredential({ claims, stationRun, repo })
    : { grant: false, reason: "run-closed" };
}
