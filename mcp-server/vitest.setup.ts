import { beforeEach, afterEach } from "vitest";
import { Llm, NoLlmProvider } from "@re-cinq/lore-shared";

// Global No-LLM guard: every test starts with the model seam disabled, so any
// path that should be deterministic (graph-ingest, task dispatch, …) fails
// loudly the instant it touches an LLM. Tests that genuinely exercise a model
// call install a FakeLlm via `Llm.setInstance(new FakeLlm(...))` in their own
// beforeEach (which runs after this one and overrides it).
beforeEach(() => {
  Llm.setInstance(new NoLlmProvider());
});

afterEach(() => {
  Llm.reset();
});
