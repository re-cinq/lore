import { describe, it, expect } from "vitest";

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

  it("boosts neutral base 0.5 by 0.15 per portable keyword to 0.8", () => {
    const score = computeTransferScore(
      "This is a common error pattern to watch for",
    );

    expect(score).toBeCloseTo(0.8, 1);
  });

  it("clamps score to 0 when five local keywords outweigh base 0.5", () => {
    const score = computeTransferScore(
      "The deploy config uses port 8080 on the auth endpoint",
    );

    expect(score).toBe(0);
  });

  it("drops score to 0.2 with two local keywords, below 0.5 threshold", () => {
    const score = computeTransferScore(
      "Set the env variable for the database url",
    );

    expect(score).toBeLessThan(0.5);
  });

  it("clamps score to 1 when four portable keywords exceed the max", () => {
    const score = computeTransferScore(
      "Gotcha: this anti-pattern causes errors in the convention",
    );

    expect(score).toBe(1);
  });

  it("clamps to [0, 1] range", () => {
    const low = computeTransferScore(
      "config deploy url auth secret env port hostname endpoint",
    );

    expect(low).toBe(0);

    const high = computeTransferScore(
      "error pattern gotcha rule convention best-practice anti-pattern",
    );

    expect(high).toBe(1);
  });

  it("nets 0.5 when portable and local keywords cancel out", () => {
    const score = computeTransferScore(
      "This error pattern happens when you deploy to the endpoint",
    );

    expect(score).toBeCloseTo(0.5, 1);
  });

  it("is case insensitive", () => {
    expect(computeTransferScore("ERROR PATTERN")).toEqual(
      computeTransferScore("error pattern"),
    );
  });
});
