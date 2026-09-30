import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { extractBearer } from "@re-cinq/lore-shared/http/bearer.js";
import { secretEquals } from "@re-cinq/lore-shared/lib/secret-equals.js";
import { PlatformGitHub } from "@re-cinq/lore-shared/project/lib/platform-github.js";
import { zodResponse } from "../../http/zod-response.js";
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

/** The git-credential provider an external floor engine asks for a repo token; its own shared bearer (`FLOOR_GIT_CREDENTIAL_TOKEN`) is the auth, so no bearer scope applies. */
export function floorGitCredentialRoute(): ServerRoute {
  return {
    method: "POST",
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
        errors: [400, 401],
      },
    ),
    handler: serveFloorGitCredential,
  };
}

async function serveFloorGitCredential(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const github = new PlatformGitHub(process.env);
  const result = await handleFloorGitCredential(
    {
      token: process.env.FLOOR_GIT_CREDENTIAL_TOKEN,
      mint: (repo) => github.getInstallationToken(repo),
    },
    extractBearer(request.headers.authorization) ?? "",
    request.payload as z.infer<typeof FloorGitCredentialBody>,
  );

  return h.response(result.body).code(result.code);
}

/** The configured shared token (absent when this deployment does not serve an external floor) and the minter that turns a repo into a fresh GitHub token. */
export interface FloorGitCredentialDeps {
  token: string | undefined;
  mint: (repo: string) => Promise<string>;
}

export type FloorGitCredentialResult =
  | { code: 200; body: { username: string; password: string } }
  | { code: 400 | 401 | 503; body: { error: string } };

export async function handleFloorGitCredential(
  deps: FloorGitCredentialDeps,
  bearer: string,
  body: z.infer<typeof FloorGitCredentialBody>,
): Promise<FloorGitCredentialResult> {
  if (!deps.token) {
    return { code: 503, body: { error: "not-configured" } };
  }

  if (!bearer || !secretEquals(bearer, deps.token)) {
    return { code: 401, body: { error: "bad-token" } };
  }
  const repo = repoOfUrl(body.repoUrl);

  if (!repo) {
    return { code: 400, body: { error: "not-a-github-repo-url" } };
  }

  return {
    code: 200,
    body: { username: "x-access-token", password: await deps.mint(repo) },
  };
}
