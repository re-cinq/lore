import { describe, it, expect, vi } from "vitest";

vi.mock("octokit", () => ({
  Octokit: vi.fn(function () {
    return { rest: {}, hook: { before: () => {} } };
  }),
}));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn() }));

import { computeStatus } from "./github.js";

describe("FR — github (web-ui)", () => {
  it("leaves a PR open when approved but a check is pending (in_progress with null conclusion)", () => {
    const pr = { state: "open", merged: false };
    const checks = [{ status: "in_progress", conclusion: null }];
    const reviews = [{ state: "APPROVED" }];

    expect(computeStatus(pr, checks, reviews)).toBe("open");
  });

  it("leaves a PR open when approved but a check is queued with null conclusion", () => {
    const pr = { state: "open", merged: false };
    const checks = [{ status: "queued", conclusion: null }];
    const reviews = [{ state: "APPROVED" }];

    expect(computeStatus(pr, checks, reviews)).toBe("open");
  });
});
