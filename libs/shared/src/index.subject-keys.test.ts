import { describe, it, expect } from "vitest";
import {
  planSubject,
  detectSubject,
  reviewSubject,
  ingestSubject,
} from "./index.js";

describe("shared index subject-key re-exports (FR6.51)", () => {
  it("subject_key formatting functions exported from shared index are callable", () => {
    expect({
      plan: planSubject("abc"),
      detect: detectSubject("drift", "my/repo"),
      review: reviewSubject(99),
      ingest: ingestSubject("specs", "sha1"),
    }).toEqual({
      plan: "plan:abc",
      detect: "detect:drift:my/repo",
      review: "review:pr-99",
      ingest: "ingest:specs:sha1",
    });
  });
});
