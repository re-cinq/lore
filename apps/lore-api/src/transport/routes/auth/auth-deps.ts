// The seams of the sign-in routes: the handoff store, GitHub, and the OAuth settings. A test hands in doubles; production reads the database, GitHub and the environment.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { Pool } from "pg";
import {
  exchangeCode,
  fetchUserRepos,
  fetchOrgRole,
  fetchViewer,
  type GithubRepo,
  type GithubViewer,
  type OAuthExchange,
  type OrgRole,
} from "../../../outbound/github-user-client.js";
import {
  pgLoginHandoffs,
  type LoginHandoffs,
} from "../../../work/auth/login-handoffs.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import { oauthConfigFrom, type OAuthConfig } from "./oauth-config.js";

export interface GithubUser {
  exchangeCode(exchange: OAuthExchange): Promise<string | null>;
  fetchViewer(token: string): Promise<GithubViewer | null>;
  fetchOrgRole(token: string, org: string): Promise<OrgRole | null>;
  fetchUserRepos(token: string): Promise<GithubRepo[]>;
}

export interface AuthDeps {
  handoffs: LoginHandoffs;
  github: GithubUser;
  config: () => OAuthConfig | null;
  getPool: () => Pool | null;
}

export function authDeps(
  getPool: () => Pool | null,
  injected: Partial<Omit<AuthDeps, "getPool">> = {},
): AuthDeps {
  return {
    handoffs: injected.handoffs ?? pgLoginHandoffs(() => poolOf(getPool)),
    github: injected.github ?? {
      exchangeCode,
      fetchViewer,
      fetchOrgRole,
      fetchUserRepos,
    },
    config: injected.config ?? (() => oauthConfigFrom(process.env)),
    getPool,
  };
}

/** The OAuth settings, or a 503 while the sign-in is not set up. */
export function requireConfig(deps: AuthDeps): OAuthConfig {
  const config = deps.config();

  enforceTrue(config, apiError(503), "github oauth not configured");

  return config;
}

function poolOf(getPool: () => Pool | null): Pool {
  const pool = getPool();

  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

  return pool;
}
