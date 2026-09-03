import { beforeEach, afterEach } from "vitest";
import { Llm, NoLlmProvider } from "@re-cinq/lore-shared";

// Every test starts with the model seam disabled to fail loudly on unintended LLM calls.
beforeEach(() => {
  Llm.setInstance(new NoLlmProvider());
  // Disable cache by default so tests observe real fetches (proxy-cache.test.ts overrides).
  process.env.LORE_CACHE_ENABLED = "false";
});

afterEach(() => {
  Llm.reset();
  delete process.env.LORE_CACHE_ENABLED;
});
