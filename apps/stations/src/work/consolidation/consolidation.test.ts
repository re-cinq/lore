import { afterEach, describe, it, expect, vi } from "vitest";
import { InMemoryMemoryLifecycle } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-memory.js";
import { consolidation, parseConsolidationPatterns } from "./consolidation.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("consolidation", () => {
  it("skips, calling no model, when the default vendor has no ANTHROPIC_API_KEY", async () => {
    vi.stubEnv("LORE_LLM_PROVIDER", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    expect(await consolidation(new InMemoryMemoryLifecycle())).toBe(
      "Skipped: no model configured (the selected LORE_LLM_PROVIDER has no key)",
    );
  });

  it("skips, calling no model, when LORE_LLM_PROVIDER=openai has no OPENAI_API_KEY", async () => {
    vi.stubEnv("LORE_LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "");

    expect(await consolidation(new InMemoryMemoryLifecycle())).toBe(
      "Skipped: no model configured (the selected LORE_LLM_PROVIDER has no key)",
    );
  });

  it("goes on to count facts with LORE_LLM_PROVIDER=openai and OPENAI_API_KEY set, with no Anthropic key", async () => {
    vi.stubEnv("LORE_LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    expect(await consolidation(new InMemoryMemoryLifecycle())).toBe(
      "Skipped: only 0 recent facts (need 5)",
    );
  });

  it("skips with 0 recent facts, 5 being the least worth consolidating", async () => {
    vi.stubEnv("LORE_LLM_PROVIDER", "");
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
