import { describe, it, expect } from "vitest";

// Copy of computeTransferScore from memory-search.ts for unit testing
const PORTABLE_KEYWORDS = [
  "error",
  "pattern",
  "gotcha",
  "rule",
  "convention",
  "best-practice",
  "anti-pattern",
];
const LOCAL_KEYWORDS = [
  "config",
  "deploy",
  "url",
  "auth",
  "secret",
  "env",
  "port",
  "hostname",
  "endpoint",
];

function computeTransferScore(text: string): number {
  const lower = text.toLowerCase();
  let score = 0.5;

  for (const kw of PORTABLE_KEYWORDS) {
    if (lower.includes(kw)) {
      score += 0.15;
    }
  }

  for (const kw of LOCAL_KEYWORDS) {
    if (lower.includes(kw)) {
      score -= 0.15;
    }
  }

  return Math.max(0, Math.min(1, score));
}

describe("computeTransferScore", () => {
  it("returns 0.5 for neutral text", () => {
    expect(
      computeTransferScore("The team uses TypeScript for all services"),
    ).toBe(0.5);
  });

  it("boosts text with portable keywords", () => {
    const score = computeTransferScore(
      "This is a common error pattern to watch for",
    );

    // base 0.5 + 0.15(error) + 0.15(pattern) = 0.8
    expect(score).toBeCloseTo(0.8, 1);
  });

  it("reduces text with local keywords", () => {
    const score = computeTransferScore(
      "The deploy config uses port 8080 on the auth endpoint",
    );

    // base 0.5 - 0.15(deploy) - 0.15(config) - 0.15(port) - 0.15(auth) - 0.15(endpoint) = -0.25 → clamped to 0
    expect(score).toBe(0);
  });

  it("filters local-only text below 0.5 threshold", () => {
    const score = computeTransferScore(
      "Set the env variable for the database url",
    );

    // base 0.5 - 0.15(env) - 0.15(url) = 0.2
    expect(score).toBeLessThan(0.5);
  });

  it("passes portable-rich text above threshold", () => {
    const score = computeTransferScore(
      "Gotcha: this anti-pattern causes errors in the convention",
    );

    // base 0.5 + 0.15(gotcha) + 0.15(anti-pattern) + 0.15(error) + 0.15(convention) = 1.1 → clamped to 1
    expect(score).toBe(1);
  });

  it("clamps to [0, 1] range", () => {
    // Many local keywords
    const low = computeTransferScore(
      "config deploy url auth secret env port hostname endpoint",
    );

    expect(low).toBe(0);

    // Many portable keywords
    const high = computeTransferScore(
      "error pattern gotcha rule convention best-practice anti-pattern",
    );

    expect(high).toBe(1);
  });

  it("handles mixed portable and local keywords", () => {
    const score = computeTransferScore(
      "This error pattern happens when you deploy to the endpoint",
    );

    // base 0.5 + 0.15(error) + 0.15(pattern) - 0.15(deploy) - 0.15(endpoint) = 0.5
    expect(score).toBeCloseTo(0.5, 1);
  });

  it("is case insensitive", () => {
    expect(computeTransferScore("ERROR PATTERN")).toEqual(
      computeTransferScore("error pattern"),
    );
  });
});
