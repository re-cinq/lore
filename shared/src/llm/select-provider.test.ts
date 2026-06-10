import { describe, it, expect } from "vitest";
import { selectProvider } from "./select-provider.js";

describe("selectProvider", () => {
  it("uses anthropic when a key is set and nothing else is configured", () => {
    expect(selectProvider({ ANTHROPIC_API_KEY: "k" }).vendor).toBe("anthropic");
  });

  it("falls back to the CLI (subscription) when anthropic is selected but no ANTHROPIC_API_KEY", () => {
    expect(selectProvider({}).vendor).toBe("cli");
  });

  it("picks cli explicitly for LORE_LLM_PROVIDER=cli", () => {
    expect(selectProvider({ LORE_LLM_PROVIDER: "cli" }).vendor).toBe("cli");
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
    expect(selectProvider({ LORE_LLM_PROVIDER: "openai", LORE_FACT_LLM: "ollama" }).vendor).toBe("openai");
  });
});
