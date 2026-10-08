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
}

export type FloorGitCredentialResult =
  | { code: 200; body: { username: string; password: string } }
  | { code: 400 | 401 | 503; body: { error: string } };

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export async function handleFloorGitCredential(
  deps: FloorGitCredentialDeps,
  bearer: string,
  body: { repoUrl: string; access: "read" | "write" },
): Promise<FloorGitCredentialResult> {
  if (!deps.token) {
    return { code: 503, body: { error: "not-configured" } };
  }

  if (!bearer || !timingSafeStringEqual(bearer, deps.token)) {
    return { code: 401, body: { error: "bad-token" } };
  }
  const repo = repoOfUrl(body.repoUrl);

  if (!repo) {
    return { code: 400, body: { error: "not-a-github-repo-url" } };
  }

  return {
    code: 200,
    body: {
      username: "x-access-token",
      password: await deps.mint(repo, body.access),
    },
  };
}

/** A secret written through a pipe often ends in a newline, and an HTTP header never carries one: compared as stored, the right token would be refused forever. */
export function configuredToken(
  stored: string | undefined,
): string | undefined {
  return stored?.trim() || undefined;
}

/** The git-credential provider an external floor engine asks for a repo token; its own shared bearer (`FLOOR_GIT_CREDENTIAL_TOKEN`) is the auth, so no bearer scope applies. */
export function floorGitCredentialRoute() {
  const req = createRequire(import.meta.url);
  const { z } = req("zod") as typeof import("zod");
  const { zodResponse } = req(
    "../../transport/http/zod-response.js",
  ) as typeof import("../../http/zod-response.js");
  const { zodValidate } = req(
    "../../transport/http/zod-validate.js",
  ) as typeof import("../../http/zod-validate.js");
  const { extractBearer } = req(
    "@re-cinq/lore-shared/http/bearer.js",
  ) as typeof import("@re-cinq/lore-shared/http/bearer.js");
  const { PlatformGitHub } = req(
    "@re-cinq/lore-shared/project/lib/platform-github.js",
  ) as typeof import("@re-cinq/lore-shared/project/lib/platform-github.js");

  const FloorGitCredentialBody = z.object({
    repoUrl: z.string().min(1),
    access: z.enum(["read", "write"]),
  });

  const GitCredentialPair = z.object({
    username: z.string(),
    password: z.string(),
  });

  return {
    method: "POST" as const,
    path: "/api/floor/git-credential",
    options: zodResponse(
      {
        auth: false,
        validate: { payload: zodValidate(FloorGitCredentialBody) },
      },
      GitCredentialPair,
      {
        name: "FloorGitCredential",
        description:
          "A freshly minted installation token for the requested repo, as the git credential-helper username/password pair",
        errors: [400, 401] as const,
      },
    ),
    handler: async (
      request: import("@hapi/hapi").Request,
      h: import("@hapi/hapi").ResponseToolkit,
    ) => {
      const github = new PlatformGitHub(process.env);
      const result = await handleFloorGitCredential(
        {
          token: configuredToken(process.env.FLOOR_GIT_CREDENTIAL_TOKEN),
          mint: (repo) => github.getInstallationToken(repo),
        },
        extractBearer(request.headers.authorization) ?? "",
        request.payload as { repoUrl: string; access: "read" | "write" },
      );

      return h.response(result.body).code(result.code);
    },
  };
}
