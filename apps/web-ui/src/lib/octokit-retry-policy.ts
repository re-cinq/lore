// Hand mirror of shared module; duplicated to prevent retry defect (#1017) on ref/file/PR creates; keep both in step.

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
