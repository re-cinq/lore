import { describe, it, expect, afterEach, vi } from "vitest";
import Hapi from "@hapi/hapi";
import type { Pool } from "pg";
import {
  createRepoAccess,
  SIGN_IN_LIST_ONLY,
} from "../work/auth/repo-access.js";
import { memoryLoginHandoffs } from "../work/auth/login-handoffs.js";
import {
  bearerScope,
  registerBearerScope,
} from "../transport/http/bearer-scope.js";
import { registerRepoGuard } from "../transport/http/repo-guard.js";
import { callbackRoute } from "../transport/routes/auth/callback.js";
import { redeemRoute } from "../transport/routes/auth/redeem.js";
import { zodFailAction } from "../transport/http/zod-validate.js";
import type { AuthDeps } from "../transport/routes/auth/auth-deps.js";
import type { OAuthConfig } from "../transport/routes/auth/oauth-config.js";
import {
  handleFloorGitCredential,
  type GitCredentialMint,
} from "../transport/routes/floor/git-credential.js";

interface StoredTokenRow {
  scopes: string[];
  kind: string;
  github_id: number;
  login: string;
  displayName: string;
  avatarUrl: string;
  repos: string[];
  startedAt: Date;
  expiresAt: Date | null;
}

const OAUTH_CONFIG: OAuthConfig = {
  clientId: "client-1",
  clientSecret: "secret-1",
  apiUrl: "https://lore-api.example",
  uiUrl: "https://lore.example",
  org: "acme",
};

const FLOOR_SECRET = "floor-secret-token-at-least-32-chars";

function createTokenPool() {
  const tokens = new Map<string, StoredTokenRow>();
  const mintedRows: unknown[][] = [];

  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM lore.settings")) {
        return { rows: [] };
      }

      if (sql.includes("INSERT INTO pipeline.api_tokens")) {
        mintedRows.push(params);
        tokens.set(String(params[1]), {
          scopes: params[2] as string[],
          kind: String(params[5]),
          github_id: params[10] as number,
          login: String(params[6]),
          displayName: String(params[7]),
          avatarUrl: String(params[8]),
          repos: params[9] as string[],
          startedAt: new Date("2026-10-28T10:00:00Z"),
          expiresAt: params[4] as Date | null,
        });

        return {
          rows: [
            {
              id: "tok-1",
              name: String(params[0]),
              scopes: params[2],
              created_at: new Date("2026-10-28T10:00:00Z"),
            },
          ],
        };
      }

      if (sql.includes("UPDATE pipeline.api_tokens SET last_used")) {
        const row = tokens.get(String(params[0]));

        return { rows: row ? [row] : [] };
      }

      return { rows: [] };
    },
  };

  return { pool: pool as unknown as Pool, tokens, mintedRows };
}

function buildSignInDeps(pool: Pool): AuthDeps {
  return {
    handoffs: memoryLoginHandoffs(),
    config: () => OAUTH_CONFIG,
    getPool: () => pool,
    github: {
      exchangeCode: async () => ({
        accessToken: "gho_user_token",
        expiresIn: 28800,
        refreshToken: "ghr_user_token",
      }),
      fetchViewer: async () => ({
        id: 7,
        login: "alice",
        name: "Alice",
        avatar_url: "https://avatars.example/alice",
      }),
      fetchOrgRole: async () => "member",
      fetchUserRepos: async () => [
        { full_name: "acme/app", owner: { login: "acme" } },
      ],
    },
  };
}

function buildRepoServer(
  pool: Pool,
  deps: AuthDeps,
  access = SIGN_IN_LIST_ONLY,
) {
  const server = Hapi.server({
    routes: { validate: { failAction: zodFailAction } },
  });

  registerBearerScope(server, () => pool);
  registerRepoGuard(server, access);
  server.route([
    callbackRoute(deps),
    redeemRoute(deps),
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}",
      options: bearerScope("read"),
      handler: (request) => ({
        repo: `${request.params.owner}/${request.params.repo}`,
      }),
    },
  ]);

  return server;
}

describe("repository identity characterization (current name-based behaviour)", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.LORE_INGEST_TOKEN;
  });

  it("records sign-in repository access as owner/name strings and admits requests by name without numeric id", async () => {
    vi.useFakeTimers({
      now: new Date("2026-10-28T10:00:00Z"),
      toFake: ["Date"],
    });
    const { pool, mintedRows } = createTokenPool();
    const deps = buildSignInDeps(pool);
    const server = buildRepoServer(pool, deps);
    const state = await deps.handoffs.put("state", {
      returnUrl: "https://lore.example/repos",
      grant: null,
    });
    const callbackRes = await server.inject({
      method: "GET",
      url: `/api/auth/callback?code=gh-1&state=${state}`,
    });
    const redeemCode = new URL(
      String(callbackRes.headers.location),
    ).searchParams.get("code");
    const redeemRes = await server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { code: redeemCode },
    });
    const { token } = JSON.parse(redeemRes.payload) as { token: string };
    const repoRes = await server.inject({
      method: "GET",
      url: "/api/repos/acme/app",
      headers: { authorization: `Bearer ${token}` },
    });

    expect({
      recordedRepos: mintedRows[0]?.[9],
      repoStatus: repoRes.statusCode,
      repoBody: JSON.parse(repoRes.payload),
    }).toEqual({
      recordedRepos: ["acme/app"],
      repoStatus: 200,
      repoBody: { repo: "acme/app" },
    });
  });

  it("refuses a repository outside the person's list whatever GitHub's collaborator level says and admits service tokens without checking repository rows", async () => {
    vi.useFakeTimers({
      now: new Date("2026-10-28T10:00:00Z"),
      toFake: ["Date"],
    });
    process.env.LORE_INGEST_TOKEN = "service-token-1";
    const { pool, tokens } = createTokenPool();
    const remembered: Array<[string, string]> = [];
    const access = createRepoAccess({
      permissionOf: async (_login, repo) =>
        repo === "acme/new-repo" ? "read" : "none",
      remember: async (tokenHash, repo) => {
        remembered.push([tokenHash, repo]);
        const row = tokens.get(tokenHash);

        if (row) {
          row.repos.push(repo);
        }
      },
      now: () => 1_700_000_000_000,
    });
    const deps = buildSignInDeps(pool);
    const server = buildRepoServer(pool, deps, access);
    const redeemCode = await deps.handoffs.put("redeem", {
      returnUrl: "https://lore.example/repos",
      grant: {
        githubId: 7,
        login: "alice",
        name: "Alice",
        avatarUrl: "https://avatars.example/alice",
        scopes: ["read"],
        repos: [],
      },
      generation: 0,
    });
    const redeemRes = await server.inject({
      method: "POST",
      url: "/api/auth/redeem",
      payload: { code: redeemCode },
    });
    const { token } = JSON.parse(redeemRes.payload) as { token: string };
    const userRes = await server.inject({
      method: "GET",
      url: "/api/repos/acme/new-repo",
      headers: { authorization: `Bearer ${token}` },
    });
    const serviceRes = await server.inject({
      method: "GET",
      url: "/api/repos/acme/untracked-repo",
      headers: { authorization: "Bearer service-token-1" },
    });

    expect({
      userStatus: userRes.statusCode,
      serviceStatus: serviceRes.statusCode,
      rememberedRepoNames: remembered.map(([, repo]) => repo),
    }).toEqual({
      userStatus: 403,
      serviceStatus: 200,
      rememberedRepoNames: [],
    });
  });

  it("mints floor git credentials against repository owner/name string without numeric id checks", async () => {
    const minted: Array<{ repo: string; access: string }> = [];
    const audited: GitCredentialMint[] = [];
    const res = await handleFloorGitCredential(
      {
        tokens: [FLOOR_SECRET],
        isOnboarded: async (repo) => repo.toLowerCase() === "acme/app",
        mint: async (repo, access) => {
          minted.push({ repo, access });

          return `ghs_${repo}_${access}`;
        },
        audit: async (entry) => {
          audited.push(entry);
        },
      },
      FLOOR_SECRET,
      { repoUrl: "https://github.com/acme/app", access: "write" },
    );

    expect({ res, minted, audited }).toEqual({
      res: {
        code: 200,
        body: { username: "x-access-token", password: "ghs_acme/app_write" },
      },
      minted: [{ repo: "acme/app", access: "write" }],
      audited: [{ repo: "acme/app", access: "write", actor: "floor" }],
    });
  });
});
