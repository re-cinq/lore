// GET /api/auth/callback — GitHub sends the person back here. Trades the code for their GitHub token pair, checks the org, and sends them on to the UI page that asked with a one-time code whose handoff row stores the encrypted token pair outside grant_json.

import type { ServerRoute } from "@hapi/hapi";
import type { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { UserGrant } from "@re-cinq/lore-shared/models/login-handoff.js";
import type {
  GithubTokenPair,
  GithubViewer,
  OrgRole,
} from "../../../outbound/github-user-client.js";
import {
  errorRedirect,
  redeemRedirect,
  SESSION_SCOPES,
} from "../../../work/auth/login-grant.js";
import { encryptTokenPair } from "../../../work/auth/token-cipher.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { requireConfig, type AuthDeps } from "./auth-deps.js";
import { CallbackQuery, RedirectSchema } from "./auth-schemas.js";
import { callbackUrl, type OAuthConfig } from "./oauth-config.js";

const OPTIONS = zodResponse(
  { auth: false as const, validate: { query: zodValidate(CallbackQuery) } },
  RedirectSchema,
  {
    name: "LoginCallbackRedirect",
    status: 302,
    description:
      "Redirects to the UI page that began the sign-in, with a code to redeem or the reason it failed",
    errors: [400],
  },
);

interface GithubSession {
  tokenPair: GithubTokenPair;
  viewer: GithubViewer;
}

export function callbackRoute(deps: AuthDeps): ServerRoute {
  return {
    method: "GET",
    path: "/api/auth/callback",
    options: OPTIONS,
    handler: async (request, h) => {
      const config = requireConfig(deps);
      const { code, state } = request.query as z.infer<typeof CallbackQuery>;
      const started = await deps.handoffs.take(state, "state");

      enforceTrue(started, apiError(400), "sign-in expired, start again");

      return h.redirect(
        await signInOutcome(deps, config, code, started.returnUrl),
      );
    },
  };
}

async function signInOutcome(
  deps: AuthDeps,
  config: OAuthConfig,
  code: string | undefined,
  returnUrl: string,
): Promise<string> {
  const session = code ? await githubSession(deps, config, code) : null;

  if (!session) {
    return errorRedirect(returnUrl, "github_denied");
  }
  const role = await roleIn(deps, config, session.tokenPair.accessToken);

  if (!role) {
    return errorRedirect(returnUrl, "not_in_org");
  }

  return storeRedeemHandoff(deps, config, session, returnUrl);
}

async function storeRedeemHandoff(
  deps: AuthDeps,
  config: OAuthConfig,
  session: GithubSession,
  returnUrl: string,
): Promise<string> {
  const grant = await grantFor(deps, session);
  const encryptedTokens = config.tokenEncryptionKey
    ? encryptTokenPair(session.tokenPair, config.tokenEncryptionKey)
    : undefined;

  return redeemRedirect(
    returnUrl,
    await deps.handoffs.put("redeem", { returnUrl, grant, encryptedTokens }),
  );
}

async function githubSession(
  deps: AuthDeps,
  config: OAuthConfig,
  code: string,
): Promise<GithubSession | null> {
  const exchanged = await deps.github.exchangeCode({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    code,
    redirectUri: callbackUrl(config),
  });
  const tokenPair = tokenPairOf(exchanged);
  const viewer = tokenPair
    ? await deps.github.fetchViewer(tokenPair.accessToken)
    : null;

  return tokenPair && validViewer(viewer) ? { tokenPair, viewer } : null;
}

function tokenPairOf(exchanged: unknown): GithubTokenPair | null {
  if (isNonEmptyString(exchanged)) {
    return { accessToken: exchanged };
  }

  if (!exchanged || typeof exchanged !== "object") {
    return null;
  }

  const candidate = exchanged as { accessToken?: unknown };

  return isNonEmptyString(candidate.accessToken)
    ? (exchanged as GithubTokenPair)
    : null;
}

function validViewer(viewer: unknown): viewer is GithubViewer {
  if (!viewer || typeof viewer !== "object") {
    return false;
  }

  return isNonEmptyString((viewer as { login?: unknown }).login);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Everyone GitHub vouches for is a member when no org is configured; otherwise only the org's active members are, with their role there. */
async function roleIn(
  deps: AuthDeps,
  config: OAuthConfig,
  token: string,
): Promise<OrgRole | null> {
  return config.org ? deps.github.fetchOrgRole(token, config.org) : "member";
}

async function grantFor(
  deps: AuthDeps,
  { tokenPair, viewer }: GithubSession,
): Promise<UserGrant> {
  const repos = await deps.github.fetchUserRepos(tokenPair.accessToken);

  return {
    login: viewer.login,
    name: viewer.name ?? viewer.login,
    avatarUrl: viewer.avatar_url,
    scopes: SESSION_SCOPES,
    repos: repos.map((repo) => repo.full_name),
  };
}
