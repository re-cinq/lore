// A hand mirror of `libs/shared/src/project/lib/octokit-retry-policy.ts`.
//
// web-ui sits outside the root workspaces and cannot import `@re-cinq/lore-shared`,
// which is why `references.ts` and `human-station.ts` are mirrored the same way.
// Duplicated here rather than left out: this client creates refs, files and pull
// requests, so it has exactly the defect the shared original prevents (#1017) —
// `plugin-retry` re-POSTing a create that GitHub already committed.
//
// Keep the two in step. The rule is one line and unlikely to move, but if it does,
// it has to move twice.

/** The subset of an Octokit client this policy needs — a `before` request hook. */
export interface HookableClient {
  hook: {
    before(
      name: "request",
      handler: (options: {
        method?: string;
        request?: Record<string, unknown>;
      }) => void,
    ): void;
  };
}

/** Stop `plugin-retry` from re-sending a POST, which duplicates what it creates. */
export function withoutBlindRetryOnCreates<T extends HookableClient>(
  client: T,
): T {
  client.hook.before("request", (options) => {
    if (options.method !== "POST") {
      return;
    }
    options.request = { ...options.request, retries: 0 };
  });

  return client;
}
