import "server-only";
import { apiFetch, type FetchOptions } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// lore-api's sign-in (ADR-053): who the session token belongs to, which repos it may open, and the swap of a sign-in's one-time code for the token. Types alias the generated schema.
export type SessionUser = components["schemas"]["AuthMe"];
export type RepoAccess = components["schemas"]["AuthAccess"];
export type RedeemedSession = components["schemas"]["LoginRedeem"];

/** The access question gates polled proxy routes, so a hung lore-api must not pin them. */
const ACCESS_DEADLINE_MS = 30_000;

export async function getMe(
  options?: FetchOptions,
): Promise<ApiResult<SessionUser>> {
  return understood(
    await apiFetch<SessionUser>("lore-api", "/api/auth/me", options),
    isSessionUser,
  );
}

export async function repoAccess(repo: string): Promise<ApiResult<RepoAccess>> {
  return understood(
    await apiFetch<RepoAccess>(
      "lore-api",
      `/api/auth/access?repo=${encodeURIComponent(repo)}`,
      { timeoutMs: ACCESS_DEADLINE_MS },
    ),
    (answer) => typeof answer.allowed === "boolean",
  );
}

const isText = (value: unknown) => typeof value === "string";
const isTextOrNull = (value: unknown) => value === null || isText(value);

/** Every field lore-api's `AuthMe` answer carries, each with the check of its own type. */
const SESSION_USER_FIELDS: Record<
  keyof SessionUser,
  (value: unknown) => boolean
> = {
  login: (value) => isText(value) && value !== "",
  name: isText,
  avatar_url: isTextOrNull,
  scopes: (value) => Array.isArray(value) && value.every(isText),
  started_at: isText,
  expires_at: isTextOrNull,
};

/** An object that merely has a `login` is some other service's answer: all of lore-api's fields must be there. */
function isSessionUser(answer: Partial<SessionUser>): boolean {
  return Object.entries(SESSION_USER_FIELDS).every(([field, holds]) =>
    holds(answer[field as keyof SessionUser]),
  );
}

/** These two answers decide who gets in, so a 2xx alone is not enough: a proxy's own page, an empty body or another service's JSON also answers 2xx. An answer that is not lore-api's is a failure, never a yes. */
function understood<T>(
  result: ApiResult<T>,
  isAnswer: (answer: Partial<T>) => boolean,
): ApiResult<T> {
  const answer: unknown = result.status === "ok" ? result.data : null;
  const known =
    typeof answer === "object" && answer !== null && isAnswer(answer);

  return result.status === "ok" && !known
    ? { status: "error", message: "lore-api's answer was not understood" }
    : result;
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
