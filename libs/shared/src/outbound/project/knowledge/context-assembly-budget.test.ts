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

function chunk(path: string, similarity?: number) {
  return {
    text: "x".repeat(400),
    tokens: 100,
    source_path: path,
    ...(similarity === undefined ? {} : { similarity }),
  };
}

function section(
  source: FetchedSection["section"]["source"],
  priority: number,
  sources: ReturnType<typeof chunk>[],
): FetchedSection {
  return {
    section: { header: source, source, priority, max_tokens: 4000 },
    res: { status: "ok", sources },
  };
}

describe("allocateSections relevance cut-off", () => {
  it("drops the ADR at similarity 0.62 when the best chunk anywhere is at 0.75, and keeps the spec at 0.70", () => {
    const { serialized } = allocateSections(
      [
        section("repo", 1, [chunk("spec-a.md", 0.75), chunk("spec-b.md", 0.7)]),
        section("adrs", 2, [chunk("adr-far.md", 0.62)]),
      ],
      8000,
    );

    expect(
      serialized.map((kept) => kept.documents.map((doc) => doc.source_path)),
    ).toEqual([["spec-a.md", "spec-b.md"]]);
  });

  it("says why a section whose every chunk fell under the cut-off was left out", () => {
    const { traceSections } = allocateSections(
      [
        section("repo", 1, [chunk("spec-a.md", 0.75)]),
        section("adrs", 2, [chunk("adr-far.md", 0.62)]),
      ],
      8000,
    );

    expect(traceSections[1]).toMatchObject({
      source: "adrs",
      included: false,
      omitReason: "nothing close enough to the question",
    });
  });

  it("keeps the best chunk itself, wherever it is, and anything within 0.08 of it", () => {
    const { serialized } = allocateSections(
      [
        section("repo", 1, [chunk("spec-near.md", 0.68)]),
        section("code", 2, [chunk("best.ts", 0.75), chunk("far.ts", 0.6)]),
      ],
      8000,
    );

    expect(
      serialized.flatMap((kept) =>
        kept.documents.map((doc) => doc.source_path),
      ),
    ).toEqual(["spec-near.md", "best.ts"]);
  });

  it("never cuts an item that carries no similarity, such as a memory or a keyword-only hit", () => {
    const { serialized } = allocateSections(
      [
        section("repo", 1, [chunk("spec-a.md", 0.75)]),
        section("memories", 2, [chunk("memory-1")]),
      ],
      8000,
    );

    expect(serialized.map((kept) => kept.source)).toEqual(["repo", "memories"]);
  });

  it("gives a cut section's share of the budget to the sections that remain", () => {
    const big = (path: string, similarity: number) => ({
      ...chunk(path, similarity),
      text: "x".repeat(12_000),
      tokens: 3000,
    });
    const alone = allocateSections(
      [
        section("repo", 1, [big("spec-a.md", 0.75), big("spec-b.md", 0.74)]),
        section("adrs", 2, [chunk("adr-far.md", 0.5)]),
      ],
      4000,
    );

    expect(alone.traceSections[0]).toMatchObject({
      source: "repo",
      allocatedBudget: 4000,
    });
  });
});
