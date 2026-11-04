import { describe, expect, it } from "vitest";
import { contextModelOf, contextSettingError } from "./context-model.js";

describe("contextModelOf", () => {
  it("takes vertex gemini-3-flash-preview from the settings page over the env", () => {
    expect(
      contextModelOf(
        {
          context_llm_provider: "vertex",
          context_llm_model: "gemini-3-flash-preview",
        },
        {
          LORE_CONTEXT_LLM_PROVIDER: "anthropic",
          LORE_CONTEXT_LLM_MODEL: "claude-haiku-4-5",
        },
      ),
    ).toEqual({ provider: "vertex", model: "gemini-3-flash-preview" });
  });

  it("gives vertex gemini-3-flash-preview when the settings name vertex and no model", () => {
    expect(contextModelOf({ context_llm_provider: "vertex" }, {})).toEqual({
      provider: "vertex",
      model: "gemini-3-flash-preview",
    });
  });

  it("turns the builder off when the settings say off, whatever the env names", () => {
    expect(
      contextModelOf(
        { context_llm_provider: "off" },
        { LORE_CONTEXT_LLM_PROVIDER: "vertex" },
      ),
    ).toBeNull();
  });

  it("falls back to LORE_CONTEXT_LLM_PROVIDER and LORE_CONTEXT_LLM_MODEL when nothing is saved", () => {
    expect(
      contextModelOf(
        {},
        {
          LORE_CONTEXT_LLM_PROVIDER: "anthropic",
          LORE_CONTEXT_LLM_MODEL: "claude-haiku-4-5",
        },
      ),
    ).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
  });

  it("writes with vertex gemini-3-flash-preview when neither the settings nor the env name a provider", () => {
    expect(contextModelOf({}, {})).toEqual({
      provider: "vertex",
      model: "gemini-3-flash-preview",
    });
  });
});

describe("contextSettingError", () => {
  it("refuses a context_llm_provider of ollama", () => {
    expect(contextSettingError("context_llm_provider", "ollama")).toBe(
      "context_llm_provider must be off, vertex or anthropic",
    );
  });

  it("accepts vertex and a blank provider, and leaves every other key alone", () => {
    expect([
      contextSettingError("context_llm_provider", "vertex"),
      contextSettingError("context_llm_provider", ""),
      contextSettingError("context_llm_model", "gemini-3-flash-preview"),
      contextSettingError("api_url", "anything"),
    ]).toEqual([null, null, null, null]);
  });
});
