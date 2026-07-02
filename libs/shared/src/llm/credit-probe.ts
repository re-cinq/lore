/**
 * Cheap Anthropic pre-flight for schedulers that dispatch many billed jobs at
 * once (e.g. the spec-task executor): before fanning out, ask whether the account
 * is out of credits so we skip the batch instead of failing every task. This is a
 * billing concern, not a completion — deliberately NOT on `LlmProvider` (which
 * models text/tool calls and logs to `pipeline.llm_calls`). Keeping it here, out
 * of the job, single-sources the model choice + the billing-error heuristic.
 */

/** Cheapest model — a credit probe should cost as little as possible. */
const CREDIT_PROBE_MODEL = "claude-haiku-4-5-20251001";

/** Matches the account-level billing errors Anthropic returns on 402/403/429. */
const BILLING_ERROR = /credit|balance|billing/i;

/**
 * True only when a minimal Anthropic request comes back with a billing/credit
 * error. A no-op (`false`) when `ANTHROPIC_API_KEY` is unset, and `false` on any
 * network error or non-billing status — proceed and let the real calls surface
 * whatever the actual problem is. `fetchImpl`/`env` are injectable for tests.
 */
export async function anthropicCreditsExhausted(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return false;
  try {
    const resp = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CREDIT_PROBE_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    if (resp.status === 429 || resp.status === 403) {
      const body = await resp.text().catch(() => "");
      return BILLING_ERROR.test(body);
    }
    return false;
  } catch {
    return false; // network error — proceed and let individual tasks handle it
  }
}
