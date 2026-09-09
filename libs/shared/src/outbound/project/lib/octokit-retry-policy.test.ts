import { describe, it, expect } from "vitest";
import { Octokit } from "octokit";
import { withoutBlindRetryOnCreates } from "./octokit-retry-policy.js";

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

function client(fetch: unknown, guarded: boolean): Octokit {
  const ok = new Octokit({
    auth: "t",
    request: { fetch },
    throttle: { enabled: false },
    retry: { retries: 1 },
  });

  return guarded ? withoutBlindRetryOnCreates(ok) : ok;
}

async function attemptsFor(route: string, guarded: boolean): Promise<string[]> {
  const { fetch, attempts } = failingFetch();

  await expect(client(fetch, guarded).request(route)).rejects.toThrow();

  return attempts;
}

describe("withoutBlindRetryOnCreates", () => {
  it("sends a failed POST exactly once, since plugin-retry blindly re-posting a 500 would double-create a review dedupe can't see", async () => {
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

  it("leaves an unguarded client retrying a POST (baseline pin — fails if an octokit upgrade makes the guard moot)", async () => {
    expect(await attemptsFor("POST /repos/o/r/pulls/1/reviews", false)).toEqual(
      ["POST", "POST"],
    );
  });
});
