import { timingSafeEqual } from "node:crypto";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { extractBearer } from "@re-cinq/lore-shared/http/bearer.js";
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import { z } from "zod";

const GITHUB_REPO_URL =
  /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;

/** `owner/name` of a github.com repository url (optional `.git` and trailing slash), or null for any other host or shape. */
export function repoOfUrl(repoUrl: string): string | null {
  const match = GITHUB_REPO_URL.exec(repoUrl);

  return match ? `${match[1]}/${match[2]}` : null;
}

/** The configured shared token (absent when this deployment does not serve an external floor) and the minter that turns a repo into a fresh GitHub token. */
export interface FloorGitCredentialDeps {
  token: string | undefined;
  mint: (repo: string, access: "read" | "write") => Promise<string>;
  isRepoOnboarded: (repo: string) => Promise<boolean>;
  audit: (
    repo: string,
    access: "read" | "write",
    caller: string,
  ) => Promise<void>;
}

export type FloorGitCredentialResult =
  | { code: 200; body: { username: string; password: string } }
  | { code: 400 | 401 | 403 | 503; body: { error: string } };

export async function handleFloorGitCredential(
  deps: FloorGitCredentialDeps,
  bearer: string,
  body: { repoUrl: string; access: "read" | "write" },
): Promise<FloorGitCredentialResult> {
  const authError = checkBearer(deps, bearer);

  if (authError) {
    return authError;
  }
  const repo = repoOfUrl(body.repoUrl);

  if (!repo) {
    return { code: 400, body: { error: "not-a-github-repo-url" } };
  }

  if (!(await deps.isRepoOnboarded(repo))) {
    return { code: 403, body: { error: "repo-not-onboarded" } };
  }

  const password = await deps.mint(repo, body.access);
  await deps.audit(repo, body.access, bearer);

  return { code: 200, body: { username: "x-access-token", password } };
}

/** A secret written through a pipe often ends in a newline, and an HTTP header never carries one: compared as stored, the right token would be refused forever. */
export function configuredToken(
  stored: string | undefined,
): string | undefined {
  return stored?.trim() || undefined;
}

/** The git-credential provider an external floor engine asks for a repo token; its own shared bearer (`FLOOR_GIT_CREDENTIAL_TOKEN`) is the auth, so no bearer scope applies. */
export function floorGitCredentialRoute(
  getPool: () => import("pg").Pool | null,
): import("@hapi/hapi").ServerRoute {
  const networkDeps = buildFloorGitCredentialNetworkDeps();
  const schemas = buildFloorGitCredentialSchemas();
  const validate = { payload: networkDeps.zodValidate(schemas.body) };
  const metadata = {
    name: "FloorGitCredential",
    description: "Minted installation token as git credential pair",
    errors: [400, 401] as (400 | 401)[],
  };

  return {
    method: "POST" as const,
    path: "/api/floor/git-credential",
    options: networkDeps.zodResponse({ auth: false as const, validate }, schemas.pair, metadata),
    handler: buildFloorGitCredentialHandler(networkDeps, getPool),
  };
}

function checkBearer(
  deps: FloorGitCredentialDeps,
  bearer: string,
): FloorGitCredentialResult | null {
  if (!deps.token) {
    return { code: 503, body: { error: "not-configured" } };
  }

  if (!bearer) {
    return { code: 401, body: { error: "bad-token" } };
  }

  const configuredTokens = deps.token.split(",");
  const isValid = configuredTokens.some((t) => timingSafeStringEqual(bearer, t.trim()));

  if (!isValid) {
    return { code: 401, body: { error: "bad-token" } };
  }

  return null;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function buildFloorGitCredentialNetworkDeps() {
  return { zodResponse, zodValidate, extractBearer, PlatformGitHub };
}

function buildFloorGitCredentialSchemas() {
  const body = z.object({
    repoUrl: z.string().min(1),
    access: z.enum(["read", "write"]),
  });
  const pair = z.object({
    username: z.string(),
    password: z.string(),
  });

  return { body, pair };
}

function buildFloorGitCredentialHandler(
  deps: ReturnType<typeof buildFloorGitCredentialNetworkDeps>,
  getPool: () => import("pg").Pool | null,
) {
  return async (
    request: import("@hapi/hapi").Request,
    h: import("@hapi/hapi").ResponseToolkit,
  ) => {
    return handleFloorGitCredentialRequest(deps, getPool, request, h);
  };
}

async function handleFloorGitCredentialRequest(
  deps: ReturnType<typeof buildFloorGitCredentialNetworkDeps>,
  getPool: () => import("pg").Pool | null,
  request: import("@hapi/hapi").Request,
  h: import("@hapi/hapi").ResponseToolkit,
) {
  const result = await handleFloorGitCredential(
    buildLiveDeps(deps, getPool),
    deps.extractBearer(request.headers.authorization) ?? "",
    request.payload as { repoUrl: string; access: "read" | "write" },
  );

  return h.response(result.body).code(result.code);
}

function buildLiveDeps(
  deps: ReturnType<typeof buildFloorGitCredentialNetworkDeps>,
  getPool: () => import("pg").Pool | null,
): FloorGitCredentialDeps {
  const github = new deps.PlatformGitHub(process.env);
  return {
    token: configuredToken(process.env.FLOOR_GIT_CREDENTIAL_TOKEN),
    mint: (repo, access) =>
      github.getInstallationToken(repo, permissionsFor(access)),
    isRepoOnboarded: (repo) => isRepoOnboardedLive(getPool, repo),
    audit: (repo, access, caller) => auditLive(getPool, repo, access, caller),
  };
}

async function isRepoOnboardedLive(
  getPool: () => import("pg").Pool | null,
  repo: string,
) {
  const pool = getPool();
  if (!pool) return false;
  const res = await pool.query(
    "SELECT 1 FROM lore.repos WHERE full_name = $1",
    [repo],
  );
  return res.rowCount !== null && res.rowCount > 0;
}

async function auditLive(
  getPool: () => import("pg").Pool | null,
  repo: string,
  access: "read" | "write",
  caller: string,
) {
  const pool = getPool();
  if (pool) {
    await pool.query(
      "INSERT INTO pipeline.audit_log (event_type, repo, actor, payload) VALUES ($1, $2, $3, $4)",
      ["git_credential_mint", repo, caller, JSON.stringify({ access })],
    );
  }
}

export function permissionsFor(
  access: "read" | "write",
): Record<string, string> {
  if (access === "read") {
    return { contents: "read", metadata: "read" };
  }

  return {
    contents: "write",
    pull_requests: "write",
    issues: "write",
    metadata: "read",
  };
}
