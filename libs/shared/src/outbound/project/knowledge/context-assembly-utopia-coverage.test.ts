import { describe, it, expect } from "vitest";
import {
  COVERAGE_SECTIONS,
  coverageItems,
} from "./context-assembly-utopia-coverage.js";
import type { SearchHit } from "../../../domain/utopia/read-shapes.js";

const hit = (externalId: string): SearchHit => ({
  chunkId: "c1",
  documentId: "d1",
  seq: 0,
  text: "tail of a split item",
  filename: externalId,
  sourceId: "src-cov",
  externalId,
  score: 0.5,
  bm25Rank: 1,
  vectorRank: null,
});

const coupling = COVERAGE_SECTIONS.coupling;

describe("coverageItems", () => {
  it("names source_path src/a.test.ts for test:src/a.test.ts#1e7912b3.2", async () => {
    const couplings = await coverageItems(
      [hit("test:src/a.test.ts#1e7912b3.2")],
      "src-cov",
      coupling!,
    );

    expect(couplings.map((coupling) => coupling.source_path)).toEqual([
      "src/a.test.ts",
    ]);
  });

  it("keeps the statement anchor specs/a/spec.md#0003 for stmt:specs/a/spec.md#0003.2", async () => {
    const couplings = await coverageItems(
      [hit("stmt:specs/a/spec.md#0003.2")],
      "src-cov",
      coupling!,
    );

    expect(couplings.map((coupling) => coupling.source_path)).toEqual([
      "specs/a/spec.md#0003",
    ]);
  });
});
