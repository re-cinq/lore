import { describe, it, expect } from "vitest";
import { parseConsolidationPatterns } from "./memory-lifecycle.js";

/**
 * This file used to define its own copy of `scoreImportance` under the comment
 * "(copied from memory-lifecycle.ts)" and re-implement the consolidation parsing
 * inline, so nothing here executed production code at all — eleven scoring tests
 * and three parsing tests, all green against re-implementations, with fourteen
 * spec anchors pointing at them (#1374).
 *
 * The scoring cases now live in `libs/shared/src/memory-ranking.test.ts`, next to
 * the real `scoreImportance`; what remains here is the consolidation parsing,
 * against the function the job actually calls.
 */

describe("parseConsolidationPatterns", () => {
  it("extracts PATTERN: prefixed lines and drops the prose around them", () => {
    const response = `Looking at these facts, I see:

PATTERN: The team consistently uses ephemeral K8s Jobs for long-running tasks to survive agent deploys.
PATTERN: Cross-repo ingestion requires HEAD ref, not specific commit SHAs.

Those are the main ones.`;

    expect(parseConsolidationPatterns(response)).toEqual([
      "The team consistently uses ephemeral K8s Jobs for long-running tasks to survive agent deploys.",
      "Cross-repo ingestion requires HEAD ref, not specific commit SHAs.",
    ]);
  });

  it("returns nothing for a NONE reply, which carries no prefix", () => {
    expect(parseConsolidationPatterns("NONE")).toEqual([]);
  });

  it("keeps 11 characters and drops 10, the filter being length > 10", () => {
    const response = [
      "PATTERN: 12345678901", // 11 — kept
      "PATTERN: 1234567890", // 10 — dropped
    ].join("\n");

    expect(parseConsolidationPatterns(response)).toEqual(["12345678901"]);
  });
});
