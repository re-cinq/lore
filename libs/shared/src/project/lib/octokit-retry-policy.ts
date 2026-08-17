// Stop `plugin-retry` from silently duplicating created resources (#1017).
//
// The `octokit` meta-package enables `plugin-retry` by default, and it retries
// 5xx and ambiguous failures WITHOUT regard for idempotency. When GitHub commits
// a `POST` and then answers with an error, the automatic retry a few seconds
// later creates the resource a second time.
//
// That is not a theoretical risk. PR #1016 received its Lore review twice, three
// seconds apart, both carrying the IDENTICAL run marker — after the marker+probe
// dedupe landed. One event row, one handler execution, one Floor replica: the
// duplicate was made below the application entirely, at the HTTP layer, where no
// marker probe, dedupe key or CAS can see it. Every Lore-authored mutation was
// exposed the same way: reviews, comments, review replies, issues, PRs, labels.
//
// The fix is structural rather than per-call. Roughly two dozen mutation sites
// call through this adapter, and adding `retries: 0` at each one leaves the next
// site anyone writes silently exposed again — the failure mode is a rule that has
// to be remembered. A single hook covers every call that exists, every call added
// later, and raw `octokit.request()` alike.
//
// Only POST loses its automatic retry. GET and HEAD are safe to repeat and the
// retry is genuinely valuable there; PUT and DELETE are idempotent by HTTP
// semantics, and the PATCHes this adapter issues set fields to fixed values, so
// repeating one lands the same state rather than a second row.
//
// Where a mutation genuinely SHOULD be retried, that belongs above this: probe
// for the marker or look the resource up, then decide. The existing marker/probe
// machinery is the complement for cross-execution redelivery, which this cannot
// see and does not try to.

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

/**
 * Install the no-blind-retry policy and return the same client, so a caller can
 * wrap construction in one expression.
 *
 * Mutates `options.request.retries` in place for POSTs. Verified against the real
 * plugin rather than assumed: a `before` hook does run early enough for the retry
 * wrapper to observe the change.
 */
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
