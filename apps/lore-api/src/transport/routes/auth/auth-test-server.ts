// Test support for the sign-in routes: a bare hapi server whose bearer strategy reads the principal from a header, and a fake GitHub that answers what a test says.

import Hapi, { type ServerRoute } from "@hapi/hapi";
import { vi, type Mock } from "vitest";
import type { Pool } from "pg";
import type { AuthDeps, GithubUser } from "./auth-deps.js";
import type { OAuthConfig } from "./oauth-config.js";
import { zodFailAction } from "../../http/zod-validate.js";
import type { Principal, TokenScope } from "../../http/auth.js";
import { memoryLoginHandoffs } from "../../../work/auth/login-handoffs.js";

export const PRINCIPAL_HEADER = "x-test-principal";

export const CONFIG: OAuthConfig = {
  clientId: "client-1",
  clientSecret: "secret-1",
  apiUrl: "https://lore-api.example",
  uiUrl: "https://lore.example",
  org: "re-cinq",
};

export function fakeGithub(overrides: Partial<GithubUser> = {}): GithubUser {
  return {
    exchangeCode: async () => "gho_abc",
    fetchViewer: async () => ({
      login: "gedaiu",
      name: "Bogdan",
      avatar_url: "https://a/1",
    }),
    fetchOrgRole: async () => "member",
    fetchOrgRepos: async () => [
      { full_name: "re-cinq/lore", owner: { login: "re-cinq" } },
      { full_name: "someone/else", owner: { login: "someone" } },
    ],
    ...overrides,
  };
}

export interface TestDeps extends AuthDeps {
  handoffs: ReturnType<typeof memoryLoginHandoffs>;
  query: Mock;
}

export function testDeps(
  overrides: { github?: Partial<GithubUser>; config?: OAuthConfig | null } = {},
): TestDeps {
  const query = vi.fn();
  const pool = { query } as unknown as Pool;

  return {
    query,
    handoffs: memoryLoginHandoffs(),
    github: fakeGithub(overrides.github),
    config: () => (overrides.config === undefined ? CONFIG : overrides.config),
    getPool: () => pool,
  };
}

/** Routes behind a strategy that trusts the principal named in `x-test-principal`; none named means the legacy token. */
export function serve(routes: ServerRoute[]): Hapi.Server {
  const server = Hapi.server({
    routes: { validate: { failAction: zodFailAction } },
  });

  server.auth.scheme("stub", () => ({
    authenticate: (request, h) => {
      const header = request.headers[PRINCIPAL_HEADER];
      const principal: Principal =
        typeof header === "string"
          ? JSON.parse(header)
          : { scopes: ["admin"], user: null, tokenHash: null };

      return h.authenticated({
        credentials: {
          scope: principal.scopes,
          user: principal.user ?? undefined,
          app: { tokenHash: principal.tokenHash },
        },
      });
    },
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.route(routes);

  return server;
}

export const userPrincipal = (
  repos: string[],
  scopes: TokenScope[] = ["read", "write", "task"],
): string =>
  JSON.stringify({
    scopes,
    user: { login: "gedaiu", name: "Bogdan", avatarUrl: "https://a/1", repos },
    tokenHash: "hash-1",
  } satisfies Principal);
