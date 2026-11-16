import type { LiveSocketClient } from "./live-socket/client";
import type { RequestMethod } from "./live-socket/pending-requests";

export interface LiveFetchInit {
  method?: RequestMethod;
  body?: unknown;
}

let client: LiveSocketClient | null = null;

const goToSignIn = (path: string): void => window.location.assign(path);
let redirectToSignIn = goToSignIn;

/** The tab has one socket by design (ADR-048); the provider that creates it hands it here so any caller can ask over it. */
export function setLiveClient(next: LiveSocketClient | null): void {
  client = next;
}

/** Where a 401 sends the person; a test swaps it for a recorder. */
export function setSignInRedirect(redirect: (path: string) => void): void {
  redirectToSignIn = redirect;
}

const signInPath = (): string =>
  `/auth/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;

/** Asks one of lore-api's routes over the tab's live socket as the signed-in person and answers as `fetch` would, so a caller changes one line. */
export async function liveFetch(
  path: string,
  init: LiveFetchInit = {},
): Promise<Response> {
  if (client === null) {
    throw new Error("live socket unavailable");
  }
  const { status, body } = await client.request(
    init.method ?? "GET",
    path,
    init.body,
  );

  if (status === 401) {
    redirectToSignIn(signInPath());
  }

  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: { "content-type": "application/json" },
  });
}
