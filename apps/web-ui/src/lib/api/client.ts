import "server-only";
import { sessionToken } from "../session-token";
import { toApiResult, type ApiResult } from "./result";

// One fetch wrapper for the Lore services (base URL, token, error mapping in one place); services are a TABLE, not a branch chain, so adding one is a row.
const SERVICES = {
  "lore-api": async (options: FetchOptions) => ({
    baseUrl: process.env.LORE_API_URL,
    token: await bearerFor(options),
  }),
} as const;

/** The signed-in person's session token (ADR-053), unless the call is anonymous or its caller, having no request scope to read the cookie from (middleware), brought its own. */
async function bearerFor(options: FetchOptions): Promise<string | null> {
  return options.anonymous ? null : (options.token ?? (await sessionToken()));
}

export type Service = keyof typeof SERVICES;

export interface FetchOptions {
  method?: string;
  body?: unknown;
  /** Seconds. Omitted → uncached, which is what a poll or a write needs. */
  revalidate?: number;
  /** The bearer to send instead of the session cookie's, for a caller outside a request scope (middleware). */
  token?: string;
  /** The route is public (the sign-in's own): send no bearer, and do not need one. */
  anonymous?: boolean;
}

/** Never throws: transport failure is a result, not an exception, so the caller decides whether it is fatal (see `enforceOk`). */
export async function apiFetch<T>(
  service: Service,
  path: string,
  options: FetchOptions = {},
): Promise<ApiResult<T>> {
  const { baseUrl, token } = await SERVICES[service](options);

  if (!baseUrl || !(token || options.anonymous)) {
    return { status: "unconfigured" };
  }

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...buildRequestInit(token, options),
    });

    return await toApiResult<T>(res);
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }
}

function buildRequestInit(
  token: string | null,
  options: FetchOptions,
): RequestInit {
  return {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
    ...(options.revalidate === undefined
      ? { cache: "no-store" as const }
      : { next: { revalidate: options.revalidate } }),
  };
}
