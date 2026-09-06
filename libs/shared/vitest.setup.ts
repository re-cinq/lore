import { beforeEach, afterEach } from "vitest";
import { Llm } from "./src/outbound/llm/llm.js";
import { NoLlmProvider } from "./src/outbound/llm/no-llm-provider.js";

// Global No-LLM guard: every test starts with the model seam disabled; tests needing a call install a FakeLlm via Llm.setInstance.
beforeEach(() => {
  Llm.setInstance(new NoLlmProvider());
});

afterEach(() => {
  Llm.reset();
});
