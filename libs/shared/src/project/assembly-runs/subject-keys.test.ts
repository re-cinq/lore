// The keys are a WIRE FORMAT between a writer and a reader in different images:
// the Floor stamps one when it starts a run, lore-api asks for the same string when
// it answers "is something already working this?". A mismatch is not a type error —
// it is a query that quietly finds nothing, which reads exactly like "nothing is in
// flight". So the spellings are pinned here, literally.

import { describe, it, expect } from "vitest";
import {
  detectSubject,
  featureSubject,
  ingestSubject,
  reviewSubject,
  backlogSubject,
} from "./subject-keys.js";

describe("subject keys", () => {
  it("featureSubject spells a feature as feature:<id>", () => {
    expect(featureSubject("02abbd59-b4af-45ab-99f3-b4e86fb672f7")).toBe(
      "feature:02abbd59-b4af-45ab-99f3-b4e86fb672f7",
    );
  });

  it("detectSubject is one run per blueprint per repo", () => {
    expect(detectSubject("spec-drift", "re-cinq/lore")).toBe(
      "detect:spec-drift:re-cinq/lore",
    );
  });

  it("reviewSubject is one review per PR", () => {
    expect(reviewSubject(1406)).toBe("review:pr-1406");
  });

  it("ingestSubject without a chunk is one run per kind and ref", () => {
    expect(ingestSubject("specs", "abc123")).toBe("ingest:specs:abc123");
  });

  it("ingestSubject carries the chunk, so sibling chunks are not duplicates", () => {
    // Dropping the chunk made chunk 2 of 40 read as a duplicate of chunk 1 and
    // silently dropped all but ~1 test-report chunk per push (2026-07-31).
    expect(ingestSubject("test-report", "abc123", "4711")).not.toBe(
      ingestSubject("test-report", "abc123", "4712"),
    );
  });

  it("a feature subject never collides with another subject family", () => {
    const keys = [
      featureSubject("1406"),
      detectSubject("spec-drift", "1406"),
      reviewSubject(1406),
      ingestSubject("specs", "1406"),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("backlogSubject", () => {
  it("is the constant backlog key — the repo is the index's other half", () => {
    expect(backlogSubject()).toBe("backlog");
  });
});
