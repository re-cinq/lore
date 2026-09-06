/** Cheap Anthropic pre-flight for job fan-out schedulers (e.g. spec-task executor): skips the whole batch when the account is out of credits, instead of failing every task; deliberately not on `LlmProvider` since this is a billing concern, not a completion. */

/** Cheapest model — a credit probe should cost as little as possible. */
const CREDIT_PROBE_MODEL = "claude-haiku-4-5-20251001";

/** Matches the account-level billing errors Anthropic returns on 402/403/429. */
const BILLING_ERROR = /credit|balance|billing/i;

function isBillingErrorStatus(status: number): boolean {
  return status === 429 || status === 403;
}

async function probeBillingError(
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
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

    if (!isBillingErrorStatus(resp.status)) {
      return false;
    }
    const body = await resp.text().catch(() => "");

    return BILLING_ERROR.test(body);
  } catch {
    return false; // network error — proceed and let individual tasks handle it
  }
}

/** True only on a billing/credit error from a minimal Anthropic request; `false` when unset, on network errors, or non-billing status (let the real calls surface the actual problem). */
export async function anthropicCreditsExhausted(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const apiKey = env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return false;
  }

  return probeBillingError(apiKey, fetchImpl);
}
