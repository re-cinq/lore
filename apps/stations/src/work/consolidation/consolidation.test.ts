import { afterEach, describe, it, expect, vi } from "vitest";
import { InMemoryMemoryLifecycle } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-memory.js";
import { consolidation, parseConsolidationPatterns } from "./consolidation.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("consolidation", () => {
  it("skips, calling no model, when no ANTHROPIC_API_KEY is set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    expect(await consolidation(new InMemoryMemoryLifecycle())).toBe(
      "Skipped: no ANTHROPIC_API_KEY",
    );
  });

  it("skips with 0 recent facts, 5 being the least worth consolidating", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");

    expect(await consolidation(new InMemoryMemoryLifecycle())).toBe(
      "Skipped: only 0 recent facts (need 5)",
    );
  });
});

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
    const response = ["PATTERN: 12345678901", "PATTERN: 1234567890"].join("\n");

    expect(parseConsolidationPatterns(response)).toEqual(["12345678901"]);
  });
});
