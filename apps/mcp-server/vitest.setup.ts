import { beforeEach, afterEach } from "vitest";
import { Llm, NoLlmProvider } from "@re-cinq/lore-shared";

// Global No-LLM guard: every test starts with the model seam disabled so a path that should be deterministic fails loudly the instant it touches an LLM; a test that genuinely needs one installs a FakeLlm in its own beforeEach.
beforeEach(() => {
  Llm.setInstance(new NoLlmProvider());
  // Disabled by default so proxy-behavior tests observe real fetches and never hit a developer's real ~/.lore/cache; proxy-cache.test.ts opts back in.
  process.env.LORE_CACHE_ENABLED = "false";
});

afterEach(() => {
  Llm.reset();
  delete process.env.LORE_CACHE_ENABLED;
});
