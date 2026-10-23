import { describe, it, expect } from "vitest";
import {
  planSubject,
  detectSubject,
  reviewSubject,
  ingestSubject,
} from "./index.js";

describe("shared index subject-key re-exports (FR6.51)", () => {
  it("subject_key formatting functions exported from shared index are callable", () => {
    expect(planSubject("abc")).toBe("plan:abc");
    expect(detectSubject("drift", "my/repo")).toBe("detect:drift:my/repo");
    expect(reviewSubject(99)).toBe("review:pr-99");
    expect(ingestSubject("specs", "sha1")).toBe("ingest:specs:sha1");
  });
});
