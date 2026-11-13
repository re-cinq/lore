import { describe, it, expect, beforeEach, vi } from "vitest";

const rest = {
  pulls: {
    get: vi.fn(),
    listReviews: vi.fn(),
  },
  checks: {
    listForRef: vi.fn(),
  },
};

vi.mock("octokit", () => ({
  Octokit: vi.fn(function () {
    return { rest, hook: { before: () => {} } };
  }),
}));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn() }));

import { getPRDetails } from "./github.js";

describe("FR — github (web-ui)", () => {
  beforeEach(() => {
    process.env.GITHUB_APP_ID = "id";
    process.env.GITHUB_APP_PRIVATE_KEY = "key";
    process.env.GITHUB_APP_INSTALLATION_ID = "inst";
    rest.pulls.get.mockReset();
    rest.pulls.listReviews.mockReset();
    rest.checks.listForRef.mockReset();
    rest.pulls.get.mockResolvedValue({
      data: {
        number: 42,
        title: "Test PR",
        state: "open",
        draft: false,
        merged: false,
        mergeable: true,
        html_url: "https://gh/pr/42",
        head: { sha: "abc1234" },
      },
    });
    rest.pulls.listReviews.mockResolvedValue({
      data: [
        {
          user: { login: "alice" },
          state: "APPROVED",
          submitted_at: "2026-11-09T00:00:00Z",
        },
      ],
    });
  });

  it("leaves a PR open when approved but a check is pending (in_progress with null conclusion)", async () => {
    rest.checks.listForRef.mockResolvedValue({
      data: {
        check_runs: [{ name: "ci", status: "in_progress", conclusion: null }],
      },
    });

    const details = await getPRDetails("re-cinq/app", 42);

    expect(details.computed_status).toBe("open");
    expect(details.checks).toEqual([
      { name: "ci", status: "in_progress", conclusion: null },
    ]);
  });

  it("leaves a PR open when approved but a check is queued with null conclusion", async () => {
    rest.checks.listForRef.mockResolvedValue({
      data: {
        check_runs: [{ name: "ci", status: "queued", conclusion: null }],
      },
    });

    const details = await getPRDetails("re-cinq/app", 42);

    expect(details.computed_status).toBe("open");
    expect(details.checks).toEqual([
      { name: "ci", status: "queued", conclusion: null },
    ]);
  });
});
