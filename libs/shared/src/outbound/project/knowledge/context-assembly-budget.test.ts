import { describe, it, expect } from "vitest";
import {
  allocateSections,
  type FetchedSection,
} from "./context-assembly-budget.js";

const shared = { text: "x".repeat(200), tokens: 50, source_path: "shared.md" };

function fetched(
  source: "repo" | "code",
  priority: number,
  max_tokens: number,
): FetchedSection {
  return {
    section: { header: source, source, priority, max_tokens },
    res: { status: "ok", sources: [shared] },
  };
}

describe("allocateSections cross-section dedupe", () => {
  it("emits a document in Relevant Code when Conventions was omitted for budget", () => {
    const { serialized, traceSections } = allocateSections(
      [fetched("repo", 1, 50), fetched("code", 3, 1000)],
      400,
    );

    expect(traceSections[0]).toMatchObject({
      source: "repo",
      included: false,
      omitReason: "budget exhausted",
    });
    expect(serialized).toHaveLength(1);
    expect(serialized[0]).toMatchObject({
      source: "code",
      documents: [{ source_path: "shared.md" }],
    });
  });
});
