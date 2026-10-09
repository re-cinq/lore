import { timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";

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
) {
  const networkDeps = buildFloorGitCredentialNetworkDeps();
  const schemas = buildFloorGitCredentialSchemas();
  const validate = { payload: networkDeps.zodValidate(schemas.body) };
  const metadata = {
    name: "FloorGitCredential",
    description: "Minted installation token as git credential pair",
    errors: [400, 401] as const,
  };

  return {
    method: "POST" as const,
    path: "/api/floor/git-credential",
    options: networkDeps.zodResponse({ auth: false, validate }, schemas.pair, metadata),
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
  const req = createRequire(import.meta.url);
  const { zodResponse } = req(
    "../../http/zod-response.js",
  ) as typeof import("../../http/zod-response.js");
  const { zodValidate } = req(
    "../../http/zod-validate.js",
  ) as typeof import("../../http/zod-validate.js");
  const { extractBearer } = req(
    "@re-cinq/lore-shared/http/bearer.js",
  ) as typeof import("@re-cinq/lore-shared/http/bearer.js");
  const { PlatformGitHub } = req(
    "@re-cinq/lore-shared/project/lib/platform-github.js",
  ) as typeof import("@re-cinq/lore-shared/project/lib/platform-github.js");

  return { zodResponse, zodValidate, extractBearer, PlatformGitHub };
}

function buildFloorGitCredentialSchemas() {
  const req = createRequire(import.meta.url);
  const zod = (req("zod") as typeof import("zod")).z;
  const body = zod.object({
    repoUrl: zod.string().min(1),
    access: zod.enum(["read", "write"]),
  });
  const pair = zod.object({
    username: zod.string(),
    password: zod.string(),
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
  const github = new deps.PlatformGitHub(process.env);
  const result = await handleFloorGitCredential(
    {
      token: configuredToken(process.env.FLOOR_GIT_CREDENTIAL_TOKEN),
      mint: (repo, access) =>
        github.getInstallationToken(repo, permissionsFor(access)),
      isRepoOnboarded: async (repo) => {
        const pool = getPool();
        if (!pool) return false;
        const res = await pool.query(
          "SELECT 1 FROM lore.repos WHERE full_name = $1",
          [repo],
        );
        return res.rowCount !== null && res.rowCount > 0;
      },
      audit: async (repo, access, caller) => {
        const pool = getPool();
        if (pool) {
          await pool.query(
            "INSERT INTO pipeline.audit_log (event_type, repo, actor, payload) VALUES ($1, $2, $3, $4)",
            ["git_credential_mint", repo, caller, JSON.stringify({ access })],
          );
        }
      },
    },
    deps.extractBearer(request.headers.authorization) ?? "",
    request.payload as { repoUrl: string; access: "read" | "write" },
  );

  return h.response(result.body).code(result.code);
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
