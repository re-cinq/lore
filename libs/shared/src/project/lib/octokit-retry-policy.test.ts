import { describe, it, expect } from "vitest";
import { Octokit } from "octokit";
import { withoutBlindRetryOnCreates } from "./octokit-retry-policy.js";

/**
 * The REAL octokit here, not the module mock the rest of the adapter's suite
 * uses: the whole defect lives inside `plugin-retry`, so a stubbed client would
 * assert nothing. A fake `fetch` returning 500 counts attempts.
 */
function failingFetch(): {
  fetch: (url: string, init?: { method?: string }) => Promise<Response>;
  attempts: string[];
} {
  const attempts: string[] = [];
  const fetch = async (url: string, init?: { method?: string }) => {
    attempts.push(init?.method ?? "GET");

    return new Response(JSON.stringify({ message: "boom" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  };

  return { fetch, attempts };
}

// One retry rather than the default three, so the read-path assertion stays fast:
// the question is whether reads retry AT ALL, not how many times.
function client(fetch: unknown, guarded: boolean): Octokit {
  const ok = new Octokit({
    auth: "t",
    request: { fetch },
    throttle: { enabled: false },
    retry: { retries: 1 },
  });

  return guarded ? withoutBlindRetryOnCreates(ok) : ok;
}

async function attemptsFor(
  route: string,
  guarded: boolean,
): Promise<string[]> {
  const { fetch, attempts } = failingFetch();

  await expect(client(fetch, guarded).request(route)).rejects.toThrow();

  return attempts;
}

describe("withoutBlindRetryOnCreates", () => {
  it("sends a failed POST exactly once", async () => {
    // The defect: plugin-retry re-POSTs a 500 without regard for idempotency, so
    // a review GitHub committed before erroring gets created a second time — the
    // duplicate every application-level dedupe sits above and cannot see.
    expect(await attemptsFor("POST /repos/o/r/pulls/1/reviews", true)).toEqual([
      "POST",
    ]);
  });

  it("still retries a failed GET, which is safe and worth keeping", async () => {
    expect(await attemptsFor("GET /repos/o/r/pulls/1", true)).toEqual([
      "GET",
      "GET",
    ]);
  });

  it("leaves an unguarded client retrying a POST, which is the bug it prevents", async () => {
    // Pins the baseline: without the policy the retry happens, so this test fails
    // if a future octokit upgrade changes the default and the guard becomes moot.
    expect(await attemptsFor("POST /repos/o/r/pulls/1/reviews", false)).toEqual([
      "POST",
      "POST",
    ]);
  });
});
