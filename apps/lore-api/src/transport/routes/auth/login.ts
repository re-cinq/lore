// GET /api/auth/login — where the web UI's sign-in button points. Remembers which UI page asked, then sends the person to GitHub's consent page; GitHub brings them back to /api/auth/callback.

import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import {
  authorizeUrl,
  returnUrlAllowed,
} from "../../../work/auth/login-grant.js";
import { requireConfig, type AuthDeps } from "./auth-deps.js";
import { LoginQuery, RedirectSchema } from "./auth-schemas.js";
import { callbackUrl, type OAuthConfig } from "./oauth-config.js";

const OPTIONS = zodResponse(
  { auth: false as const, validate: { query: zodValidate(LoginQuery) } },
  RedirectSchema,
  {
    name: "LoginRedirect",
    status: 302,
    description: "Redirects to GitHub's consent page for the sign-in",
    errors: [400],
  },
);

export function loginRoute(deps: AuthDeps): ServerRoute {
  return {
    method: "GET",
    path: "/api/auth/login",
    options: OPTIONS,
    handler: (request, h) => beginSignIn(deps, request, h),
  };
}

async function beginSignIn(
  deps: AuthDeps,
  request: Request,
  h: ResponseToolkit,
) {
  const config = requireConfig(deps);
  const { return: returnUrl } = request.query as z.infer<typeof LoginQuery>;

  enforceTrue(
    returnUrlAllowed(returnUrl, { LORE_UI_URL: config.uiUrl }),
    apiError(400),
    "return url not allowed",
  );
  const state = await deps.handoffs.put("state", { returnUrl, grant: null });

  return h.redirect(consentUrl(config, state));
}

function consentUrl(config: OAuthConfig, state: string): string {
  return authorizeUrl({
    clientId: config.clientId,
    redirectUri: callbackUrl(config),
    state,
  });
}
