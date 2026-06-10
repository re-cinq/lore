import { describe, it, expect } from "vitest";
import { selectProvider } from "./select-provider.js";

describe("selectProvider", () => {
  it("defaults to anthropic when nothing is configured", () => {
    expect(selectProvider({}).vendor).toBe("anthropic");
  });

  it("picks openai for LORE_LLM_PROVIDER=openai", () => {
    expect(selectProvider({ LORE_LLM_PROVIDER: "openai" }).vendor).toBe("openai");
  });

  it("picks ollama for LORE_LLM_PROVIDER=ollama", () => {
    expect(selectProvider({ LORE_LLM_PROVIDER: "ollama" }).vendor).toBe("ollama");
  });

  it("honors LORE_FACT_LLM when LORE_LLM_PROVIDER is unset", () => {
    expect(selectProvider({ LORE_FACT_LLM: "ollama" }).vendor).toBe("ollama");
  });

  it("lets LORE_LLM_PROVIDER win over LORE_FACT_LLM", () => {
    expect(selectProvider({ LORE_LLM_PROVIDER: "anthropic", LORE_FACT_LLM: "ollama" }).vendor).toBe("anthropic");
  });
});
