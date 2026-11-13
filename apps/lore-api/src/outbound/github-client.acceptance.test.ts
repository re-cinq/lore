import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchPrStatus } from "./github-client.js";

const originalToken = process.env.GITHUB_TOKEN;

afterEach(() => {
  process.env.GITHUB_TOKEN = originalToken;
  vi.unstubAllGlobals();
});

describe("T004: Implement concurrent fetching for PR status", () => {
  it("starts fetching check-runs as soon as PR resolves, without waiting for reviews or threads", async () => {
    process.env.GITHUB_TOKEN = "t0k3n";

    let reviewsResolved = false;
    let checkRunsFetchedBeforeReviewsResolved = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const isPr = url.endsWith("/pulls/5");
        const isReviewsOrGraphQL =
          url.endsWith("/reviews") || url.endsWith("/graphql");
        const isCheckRuns = url.includes("/check-runs");

        if (isPr) {
          await new Promise((resolve) => setTimeout(resolve, 10));

          return {
            ok: true,
            status: 200,
            json: async () => ({ number: 5, head: { sha: "abc123" } }),
          };
        }

        if (isReviewsOrGraphQL) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          reviewsResolved = true;

          return { ok: true, status: 200, json: async () => [] };
        }

        if (isCheckRuns) {
          checkRunsFetchedBeforeReviewsResolved = !reviewsResolved;

          return {
            ok: true,
            status: 200,
            json: async () => ({ check_runs: [] }),
          };
        }

        return { ok: false, status: 404 };
      }),
    );

    await fetchPrStatus("o/r", 5);
    expect(checkRunsFetchedBeforeReviewsResolved).toBe(true);
  });
});
