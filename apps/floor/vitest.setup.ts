import { beforeEach, afterEach } from "vitest";
import { Llm, NoLlmProvider } from "@re-cinq/lore-shared";

// Global No-LLM guard: deterministic paths fail loudly if they touch an LLM; tests needing one override via Llm.setInstance(new FakeLlm(...)) in their own beforeEach.
beforeEach(() => {
  Llm.setInstance(new NoLlmProvider());
});

afterEach(() => {
  Llm.reset();
});
