import { describe, it, expect, afterEach, vi } from "vitest";
import { Octokit } from "octokit";
import { PlatformGitHub } from "./platform-github.js";

/**
 * Replication of the #1017 / #1041 duplicate-review incident against the REAL
 * octokit plugin-retry (platform-github.retry.test.ts mocks octokit and only
 * asserts the request option is passed; this file proves the plugin behavior
 * the fix relies on). The trigger: GitHub commits the createReview POST but
 * answers with a retryable error (5xx/timeout — 500 is not in plugin-retry's
 * doNotRetry list). The fake below records the review BEFORE answering 500,
 * exactly that committed-but-errored shape.
 */

function fakeGitHub() {
  const committedReviews: Array<Record<string, unknown>> = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const fetch = async (url: unknown, init?: RequestInit) => {
    if (
      init?.method === "POST" &&
      String(url).endsWith("/pulls/1041/reviews")
    ) {
      committedReviews.push(JSON.parse(String(init.body)));

      return committedReviews.length === 1
        ? json(500, { message: "Server Error" })
        : json(200, { id: 4843754611 });
    }

    return json(200, {});
  };

  return { fetch, committedReviews };
}

const reviewInput = {
  event: "COMMENT" as const,
  body: "### Lore review — Approved\n\n<!-- lore-review-run: 33275ff5/review/1 -->",
  comments: [{ path: "a.ts", line: 3, body: "**issue:** dup" }],
};

describe("plugin-retry duplicate-POST behavior", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replicates the incident: default retry re-POSTs a committed review answered with a 500, committing a duplicate", async () => {
    const github = fakeGitHub();
    const octokit = new Octokit({
      auth: "test-token",
      retry: { retryAfterBaseValue: 1 },
      request: { fetch: github.fetch },
    });

    const response = await octokit.rest.pulls.createReview({
      owner: "re-cinq",
      repo: "lore",
      pull_number: 1041,
      event: reviewInput.event,
      body: reviewInput.body,
      comments: reviewInput.comments,
    });

    expect(response.status).toBe(200);
    expect(github.committedReviews).toHaveLength(2);
    expect(github.committedReviews[0]).toEqual(github.committedReviews[1]);
  });

  it("createReview under the NO_RETRY policy surfaces the 500 after exactly one committed POST", async () => {
    const github = fakeGitHub();

    vi.stubGlobal("fetch", github.fetch);
    const platform = new PlatformGitHub({
      GITHUB_TOKEN: "test-token",
    } as NodeJS.ProcessEnv);

    await expect(
      platform.createReview("re-cinq/lore", 1041, reviewInput),
    ).rejects.toThrow("Server Error");

    expect(github.committedReviews).toHaveLength(1);
  });
});
