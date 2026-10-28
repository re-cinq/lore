// GET /api/auth/callback — GitHub sends the person back here. Trades the code for their GitHub token, checks the org, and sends them on to the UI page that asked with a one-time code to redeem. The GitHub token lives in this function only: it is never stored or logged.

import type { ServerRoute } from "@hapi/hapi";
import type { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { UserGrant } from "@re-cinq/lore-shared/models/login-handoff.js";
import type {
  GithubViewer,
  OrgRole,
} from "../../../outbound/github-user-client.js";
import {
  errorRedirect,
  orgRepoNames,
  redeemRedirect,
  scopesForRole,
} from "../../../work/auth/login-grant.js";
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
  token: string;
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
  code: string,
  returnUrl: string,
): Promise<string> {
  const session = await githubSession(deps, config, code);

  if (!session) {
    return errorRedirect(returnUrl, "github_denied");
  }
  const role = await roleIn(deps, config, session.token);

  if (!role) {
    return errorRedirect(returnUrl, "not_in_org");
  }
  const grant = await grantFor(deps, config, session, role);

  return redeemRedirect(
    returnUrl,
    await deps.handoffs.put("redeem", { returnUrl, grant }),
  );
}

async function githubSession(
  deps: AuthDeps,
  config: OAuthConfig,
  code: string,
): Promise<GithubSession | null> {
  const token = await deps.github.exchangeCode({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    code,
    redirectUri: callbackUrl(config),
  });
  const viewer = token ? await deps.github.fetchViewer(token) : null;

  return token && viewer ? { token, viewer } : null;
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
  config: OAuthConfig,
  { token, viewer }: GithubSession,
  role: OrgRole,
): Promise<UserGrant> {
  const repos = await deps.github.fetchOrgRepos(token);

  return {
    login: viewer.login,
    name: viewer.name ?? viewer.login,
    avatarUrl: viewer.avatar_url,
    scopes: scopesForRole(role),
    repos: orgRepoNames(repos, config.org),
  };
}
