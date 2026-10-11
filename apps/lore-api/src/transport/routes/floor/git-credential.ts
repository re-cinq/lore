import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { extractBearer } from "@re-cinq/lore-shared/http/bearer.js";
import { secretEquals } from "@re-cinq/lore-shared/lib/secret-equals.js";
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import {
  zodResponse,
  type DeclaredErrorStatus,
} from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";

const FloorGitCredentialBody = z.object({
  repoUrl: z.string().min(1),
  access: z.enum(["read", "write"]),
});

const GitCredentialPair = z.object({
  username: z.string(),
  password: z.string(),
});

const GITHUB_REPO_URL =
  /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;

/** `owner/name` of a github.com repository url (optional `.git` and trailing slash), or null for any other host or shape. */
export function repoOfUrl(repoUrl: string): string | null {
  const match = GITHUB_REPO_URL.exec(repoUrl);

  return match ? `${match[1]}/${match[2]}` : null;
}

type Access = z.infer<typeof FloorGitCredentialBody>["access"];

/** What a pod token may do: a read clones, a write pushes a branch (workflow files included: onboarding and loop tickets touch them) and opens or comments on its pull request. Never secrets, hooks or checks. */
export function podPermissions(access: Access): Record<string, Access> {
  if (access === "read") {
    return { contents: "read", metadata: "read" };
  }

  return {
    contents: "write",
    pull_requests: "write",
    issues: "write",
    workflows: "write",
    metadata: "read",
  };
}

const ROUTE_DOC = {
  name: "FloorGitCredential",
  description:
    "A freshly minted installation token for the requested repo, as the git credential-helper username/password pair",
  errors: [400, 401, 403] as DeclaredErrorStatus[],
};

/** The git-credential provider an external floor engine asks for a repo token; its own shared bearer (`FLOOR_GIT_CREDENTIAL_TOKEN`) is the auth, so no bearer scope applies. */
export function floorGitCredentialRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/floor/git-credential",
    options: zodResponse(
      {
        auth: false,
        validate: { payload: zodValidate(FloorGitCredentialBody) },
      },
      GitCredentialPair,
      ROUTE_DOC,
    ),
    handler: (request, h) => serveFloorGitCredential(getPool, request, h),
  };
}

async function serveFloorGitCredential(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const result = await handleFloorGitCredential(
    liveDeps(getPool),
    extractBearer(request.headers.authorization) ?? "",
    request.payload as z.infer<typeof FloorGitCredentialBody>,
  );

  return h.response(result.body).code(result.code);
}

function liveDeps(getPool: () => Pool | null): FloorGitCredentialDeps {
  const github = new PlatformGitHub(process.env);

  return {
    tokens: configuredTokens(process.env.FLOOR_GIT_CREDENTIAL_TOKEN),
    mint: (repo, access) =>
      github.getInstallationToken(repo, podPermissions(access)),
    isOnboarded: (repo) => isOnboarded(getPool(), repo),
    audit: (mint) => auditMint(getPool(), mint),
  };
}

async function isOnboarded(pool: Pool | null, repo: string): Promise<boolean> {
  const found = await pool?.query(
    "SELECT 1 FROM lore.repos WHERE full_name = $1",
    [repo],
  );

  return Boolean(found?.rowCount);
}

async function auditMint(
  pool: Pool | null,
  { repo, access, actor }: GitCredentialMint,
): Promise<void> {
  await pool?.query(
    "INSERT INTO pipeline.audit_log (event_type, repo, actor, payload) VALUES ('git_credential_mint', $1, $2, $3)",
    [repo, actor, JSON.stringify({ access })],
  );
}

/** One mint as the audit log records it. The actor is the caller's identity, never its bearer: the bearer is the shared secret. */
export interface GitCredentialMint {
  repo: string;
  access: Access;
  actor: "floor";
}

/** The accepted shared tokens (none when this deployment does not serve an external floor), the minter, the onboarded-repo check and the audit sink. */
export interface FloorGitCredentialDeps {
  tokens: string[];
  mint: (repo: string, access: Access) => Promise<string>;
  isOnboarded: (repo: string) => Promise<boolean>;
  audit: (mint: GitCredentialMint) => Promise<void>;
}

export type FloorGitCredentialResult =
  | { code: 200; body: { username: string; password: string } }
  | { code: 400 | 401 | 403 | 503; body: { error: string } };

export async function handleFloorGitCredential(
  deps: FloorGitCredentialDeps,
  bearer: string,
  body: z.infer<typeof FloorGitCredentialBody>,
): Promise<FloorGitCredentialResult> {
  const repo = repoOfUrl(body.repoUrl);
  const refused = refusal(deps.tokens, bearer, repo);

  if (refused) {
    return refused;
  }

  if (!repo || !(await deps.isOnboarded(repo))) {
    return { code: 403, body: { error: "repo-not-onboarded" } };
  }
  const password = await deps.mint(repo, body.access);

  await deps.audit({ repo, access: body.access, actor: "floor" });

  return { code: 200, body: { username: "x-access-token", password } };
}

function refusal(
  tokens: string[],
  bearer: string,
  repo: string | null,
): FloorGitCredentialResult | null {
  if (tokens.length === 0) {
    return { code: 503, body: { error: "not-configured" } };
  }

  if (!bearer || !tokens.some((token) => secretEquals(bearer, token))) {
    return { code: 401, body: { error: "bad-token" } };
  }

  return repo ? null : { code: 400, body: { error: "not-a-github-repo-url" } };
}

/** `current,next` while a rotation is under way, so neither side has to restart at the same moment. Each is trimmed: a secret written through a pipe often ends in a newline, and an HTTP header never carries one. */
export function configuredTokens(stored: string | undefined): string[] {
  return (stored ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}
