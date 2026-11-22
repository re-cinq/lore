/** The seam that lets a server refuse a GitHub write made through the App's client while it serves a person (FR-311). */

import type { HookableClient } from "./octokit-retry-policy.js";

type WriteGuard = (method: string) => void;

let guard: WriteGuard | null = null;

/** Registers (or clears) the check run before every request an App-authenticated client sends. */
export function setAppClientWriteGuard(next: WriteGuard | null): void {
  guard = next;
}

/** Runs the registered check on every non-read request this App client sends, then returns the same client. */
export function guardAppClient<T extends HookableClient>(client: T): T {
  client.hook.before("request", (options) => {
    const method = (options.method ?? "GET").toUpperCase();

    if (
      method !== "GET" &&
      method !== "HEAD" &&
      !mintsInstallationToken(options)
    ) {
      guard?.(method);
    }
  });

  return client;
}

/** Minting the App's installation token is how the App authenticates, not a write to a repository, so it passes. */
function mintsInstallationToken(options: { url?: string }): boolean {
  return /\/app\/installations\/[^/]+\/access_tokens$/.test(options.url ?? "");
}
