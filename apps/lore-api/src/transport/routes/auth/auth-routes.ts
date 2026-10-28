// The routes of the web UI's sign-in: lore-api runs the GitHub OAuth dance and hands the UI a session token (ADR-053).

import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { authDeps, type AuthDeps } from "./auth-deps.js";
import { callbackRoute } from "./callback.js";
import { loginRoute } from "./login.js";
import { redeemRoute } from "./redeem.js";
import { accessRoute, logoutRoute, meRoute } from "./session.js";

export function authRoutes(
  getPool: () => Pool | null,
  injected: Partial<Omit<AuthDeps, "getPool">> = {},
): ServerRoute[] {
  const deps = authDeps(getPool, injected);

  return [
    loginRoute(deps),
    callbackRoute(deps),
    redeemRoute(deps),
    meRoute(),
    accessRoute(),
    logoutRoute(getPool),
  ];
}
