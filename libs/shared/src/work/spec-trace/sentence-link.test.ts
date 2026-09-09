import { describe, it, expect } from "vitest";
import {
  normalizeForMatch,
  parseSentenceLink,
  matchesNormalized,
  sentenceLinkFromSuite,
} from "./sentence-link.js";

describe("normalizeForMatch", () => {
  it("lowercases and removes all whitespace", () => {
    expect(normalizeForMatch("Onboarding a new repo")).toBe(
      "onboardinganewrepo",
    );
  });

  it("collapses a multi-line sentence with ragged indentation", () => {
    expect(normalizeForMatch("first\n   attempt within 5 minutes")).toBe(
      "firstattemptwithin5minutes",
    );
  });

  it("strips a trailing inline link parenthetical", () => {
    expect(
      normalizeForMatch("does the thing ([validated by](a.test.ts#L1))"),
    ).toBe("doesthething");
  });
});

describe("parseSentenceLink", () => {
  it("splits a spec | sentence | label test name", () => {
    expect(
      parseSentenceLink(
        "Lore Agent Service | Onboarding a new repo within 5 minutes | produces a PR",
      ),
    ).toEqual({
      spec: "Lore Agent Service",
      sentence: "Onboarding a new repo within 5 minutes",
      label: "produces a PR",
    });
  });

  it("keeps later pipes as part of the label", () => {
    expect(parseSentenceLink("A | B | c | d")).toEqual({
      spec: "A",
      sentence: "B",
      label: "c | d",
    });
  });

  it("returns null when there are fewer than three segments", () => {
    expect(parseSentenceLink("only | two")).toBeNull();
    expect(parseSentenceLink("no pipes here")).toBeNull();
  });
});

describe("sentenceLinkFromSuite", () => {
  it("derives spec/sentence/label from a 3-level describe>describe>it chain", () => {
    expect(
      sentenceLinkFromSuite({
        id: "x",
        file: "x.test.ts",
        name: "produces a PR",
        suite: ["Lore Agent Service", "Onboarding a new repo within 5 minutes"],
      }),
    ).toEqual({
      spec: "Lore Agent Service",
      sentence: "Onboarding a new repo within 5 minutes",
      label: "produces a PR",
    });
  });

  it("returns null for a two-level unit-test chain (one describe + it)", () => {
    expect(
      sentenceLinkFromSuite({
        id: "x",
        file: "x.test.ts",
        name: "returns refs",
        suite: ["parseAdrRefs"],
      }),
    ).toBeNull();
  });

  it("returns null when there is no suite at all", () => {
    expect(
      sentenceLinkFromSuite({ id: "x", file: "x.test.ts", name: "bare" }),
    ).toBeNull();
  });

  it("takes the first two describe levels as spec and sentence when nested deeper", () => {
    expect(
      sentenceLinkFromSuite({
        id: "x",
        file: "x.test.ts",
        name: "leaf",
        suite: ["Spec Title", "The sentence", "extra group"],
      }),
    ).toEqual({ spec: "Spec Title", sentence: "The sentence", label: "leaf" });
  });
});

describe("matchesNormalized", () => {
  it("matches a spec segment as a substring of the H1 title, ignoring case and spaces", () => {
    expect(
      matchesNormalized(
        "Feature Specification: Lore Agent Service",
        "lore agent service",
      ),
    ).toBe(true);
  });

  it("matches a sentence inside a statement that carries an inline link", () => {
    expect(
      matchesNormalized(
        "Onboarding a new repo within 5 minutes ([validated by](x.test.ts#L1))",
        "Onboarding a new repo within 5 minutes",
      ),
    ).toBe(true);
  });

  it("does not match an unrelated needle", () => {
    expect(
      matchesNormalized("Onboarding a new repo", "deletes the database"),
    ).toBe(false);
  });
});
