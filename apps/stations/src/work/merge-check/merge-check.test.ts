import { describe, it, expect } from "vitest";
import { parseOnboardingPrUrl } from "./merge-check.js";

describe("parseOnboardingPrUrl", () => {
  it("reads owner, repo, and PR number from a github.com pull URL", () => {
    expect(
      parseOnboardingPrUrl("https://github.com/acme/widgets/pull/42"),
    ).toEqual({ owner: "acme", repoName: "widgets", number: 42 });
  });

  it("returns null for a URL that carries no pull request", () => {
    expect(parseOnboardingPrUrl("https://github.com/acme/widgets")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseOnboardingPrUrl("")).toBeNull();
  });
});

describe("parseOnboardingPrUrl on host ghe.example.com", () => {
  it("reads owner, repo, and PR number from https://ghe.example.com/acme/widgets/pull/42", () => {
    expect(
      parseOnboardingPrUrl(
        "https://ghe.example.com/acme/widgets/pull/42",
        "ghe.example.com",
      ),
    ).toEqual({ owner: "acme", repoName: "widgets", number: 42 });
  });

  it("returns null for https://github.com/acme/widgets/pull/42", () => {
    expect(
      parseOnboardingPrUrl(
        "https://github.com/acme/widgets/pull/42",
        "ghe.example.com",
      ),
    ).toBeNull();
  });
});
