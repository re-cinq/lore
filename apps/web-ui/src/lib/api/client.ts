import "server-only";
import { toApiResult, type ApiResult } from "./result";

// One fetch wrapper for both Lore services, so base URL, token choice and error
// mapping have a single home. Five modules used to repeat this.
//
// Service resolution is a TABLE rather than a branch chain — adding a service is
// a row, and the token each one uses is visible side by side.
const SERVICES = {
  "lore-api": () => ({
    baseUrl: process.env.LORE_API_URL,
    // Admin first: the UI performs privileged writes the ingest token cannot.
    token: process.env.LORE_ADMIN_TOKEN ?? process.env.LORE_INGEST_TOKEN,
  }),
  floor: () => ({
    baseUrl: process.env.LORE_FLOOR_URL,
    token: process.env.LORE_INGEST_TOKEN,
  }),
} as const;

export type Service = keyof typeof SERVICES;

export interface FetchOptions {
  method?: string;
  body?: unknown;
  /** Seconds. Omitted → uncached, which is what a poll or a write needs. */
  revalidate?: number;
}

/** Call a Lore service. Never throws: transport failure is a result, not an
 *  exception, so a caller decides whether it is fatal (see `enforceOk`). */
export async function apiFetch<T>(
  service: Service,
  path: string,
  options: FetchOptions = {},
): Promise<ApiResult<T>> {
  const { baseUrl, token } = SERVICES[service]();

  if (!baseUrl || !token) {
    return { status: "unconfigured" };
  }

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      ...(options.revalidate === undefined
        ? { cache: "no-store" as const }
        : { next: { revalidate: options.revalidate } }),
    });

    return await toApiResult<T>(res);
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }
}
