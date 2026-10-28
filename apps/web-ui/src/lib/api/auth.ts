import "server-only";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// lore-api's sign-in (ADR-053): who the session token belongs to, which repos it may open, and the swap of a sign-in's one-time code for the token. Types alias the generated schema.
export type SessionUser = components["schemas"]["AuthMe"];
export type RepoAccess = components["schemas"]["AuthAccess"];
export type RedeemedSession = components["schemas"]["LoginRedeem"];

export function getMe(): Promise<ApiResult<SessionUser>> {
  return apiFetch("lore-api", "/api/auth/me");
}

export function repoAccess(repo: string): Promise<ApiResult<RepoAccess>> {
  return apiFetch(
    "lore-api",
    `/api/auth/access?repo=${encodeURIComponent(repo)}`,
  );
}

/** The sign-in's one-time code for the session token; the route is public, so no bearer goes with it. */
export function redeemCode(code: string): Promise<ApiResult<RedeemedSession>> {
  return apiFetch("lore-api", "/api/auth/redeem", {
    method: "POST",
    body: { code },
    anonymous: true,
  });
}

/** Ends the session: its token stops working at once. */
export function endSession(): Promise<ApiResult<{ ok: true }>> {
  return apiFetch("lore-api", "/api/auth/logout", { method: "POST" });
}
