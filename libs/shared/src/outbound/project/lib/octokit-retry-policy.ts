// Stop `plugin-retry` from silently duplicating created resources: it retries 5xx/ambiguous POST failures with no idempotency check, which double-posted PR #1016's review at the HTTP layer (#1017). Only POST loses automatic retry — GET/HEAD/PUT/DELETE/PATCH stay retried since they're safe to repeat.

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

/** Install the no-blind-retry policy and return the same client, so a caller can wrap construction in one expression; mutates `options.request.retries` in place for POSTs. */
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
