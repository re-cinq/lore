import { beforeEach, afterEach } from "vitest";
import { Llm } from "./src/llm/llm.js";
import { NoLlmProvider } from "./src/llm/no-llm-provider.js";

// Global No-LLM guard (see agent/mcp setup): every test starts with the model
// seam disabled so deterministic paths prove they never call an LLM. Tests that
// need a model call install a FakeLlm via Llm.setInstance in their own beforeEach.
beforeEach(() => {
  Llm.setInstance(new NoLlmProvider());
});

afterEach(() => {
  Llm.reset();
});
