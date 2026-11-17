import { describe, it, expect } from "vitest";
import {
  llmConfigured,
  selectProvider,
  selectProviderFor,
} from "./select-provider.js";
import { startRecordingHttpServer } from "../../test-helpers/recording-http-server.js";

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
    expect(selectProvider({ LORE_LLM_PROVIDER: "openai" }).vendor).toBe(
      "openai",
    );
  });

  it("throws naming mistral and the known vendors for LORE_LLM_PROVIDER=mistral", () => {
    expect(() => selectProvider({ LORE_LLM_PROVIDER: "mistral" })).toThrow(
      new Error(
        "Unknown LLM provider mistral; known: ollama, gemini, vertex, openai, cli, claude, anthropic",
      ),
    );
  });

  it("picks ollama for LORE_LLM_PROVIDER=ollama", () => {
    expect(selectProvider({ LORE_LLM_PROVIDER: "ollama" }).vendor).toBe(
      "ollama",
    );
  });

  it("picks gemini for LORE_LLM_PROVIDER=gemini", () => {
    expect(selectProvider({ LORE_LLM_PROVIDER: "gemini" }).vendor).toBe(
      "gemini",
    );
  });

  it("honors LORE_FACT_LLM when LORE_LLM_PROVIDER is unset", () => {
    expect(selectProvider({ LORE_FACT_LLM: "ollama" }).vendor).toBe("ollama");
  });

  it("lets LORE_LLM_PROVIDER win over LORE_FACT_LLM", () => {
    expect(
      selectProvider({ LORE_LLM_PROVIDER: "gemini", LORE_FACT_LLM: "ollama" })
        .vendor,
    ).toBe("gemini");
  });

  it("picks vertex for LORE_LLM_PROVIDER=vertex", () => {
    expect(selectProvider({ LORE_LLM_PROVIDER: "vertex" }).vendor).toBe(
      "vertex",
    );
  });
});

describe("selectProviderFor", () => {
  it("picks vertex for the eval use when LORE_EVAL_LLM_PROVIDER=vertex and the process runs anthropic", () => {
    const env = { ANTHROPIC_API_KEY: "k", LORE_EVAL_LLM_PROVIDER: "vertex" };

    expect(selectProviderFor("eval", env).vendor).toBe("vertex");
    expect(selectProvider(env).vendor).toBe("anthropic");
  });

  it("falls back to the process vendor ollama when the eval use names none", () => {
    expect(
      selectProviderFor("eval", { LORE_LLM_PROVIDER: "ollama" }).vendor,
    ).toBe("ollama");
  });
});

describe("selectProviderFor openai", () => {
  it("runs the eval use on openai while the process runs anthropic", () => {
    const env = { ANTHROPIC_API_KEY: "k", LORE_EVAL_LLM_PROVIDER: "openai" };

    expect(selectProviderFor("eval", env).vendor).toBe("openai");
  });

  it("sends the per-use model gpt-5-mini to the base URL the env names", async () => {
    const server = await startRecordingHttpServer({
      choices: [{ message: { content: "a" } }],
    });
    const env = {
      OPENAI_API_KEY: "k",
      OPENAI_BASE_URL: server.baseUrl,
      LORE_EVAL_LLM_PROVIDER: "openai",
      LORE_EVAL_LLM_MODEL: "gpt-5-mini",
    };

    await selectProviderFor("eval", env).complete({ prompt: "u" });
    server.close();

    expect(server.requests).toMatchObject([
      {
        url: "/openai/v1/chat/completions",
        authorization: "Bearer k",
        body: { model: "gpt-5-mini" },
      },
    ]);
  });
});

describe("llmConfigured", () => {
  const envs: Record<string, NodeJS.ProcessEnv> = {
    openaiWithKey: { LORE_LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" },
    openaiWithoutKey: { LORE_LLM_PROVIDER: "openai" },
    defaultClaudeWithKey: { ANTHROPIC_API_KEY: "k" },
    defaultClaudeWithoutKey: {},
    anthropicWithKey: {
      LORE_LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "k",
    },
    geminiWithKey: { LORE_LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" },
    geminiWithoutKey: { LORE_LLM_PROVIDER: "gemini" },
    vertexWithoutKey: { LORE_LLM_PROVIDER: "vertex" },
    ollamaWithoutKey: { LORE_FACT_LLM: "ollama" },
    cliWithoutKey: { LORE_LLM_PROVIDER: "cli" },
  };

  it("is true for openai, claude, anthropic and gemini with their key and for vertex, ollama and cli with none, false for openai, claude and gemini without", () => {
    expect(
      Object.fromEntries(
        Object.entries(envs).map(([name, env]) => [name, llmConfigured(env)]),
      ),
    ).toEqual({
      openaiWithKey: true,
      openaiWithoutKey: false,
      defaultClaudeWithKey: true,
      defaultClaudeWithoutKey: false,
      anthropicWithKey: true,
      geminiWithKey: true,
      geminiWithoutKey: false,
      vertexWithoutKey: true,
      ollamaWithoutKey: true,
      cliWithoutKey: true,
    });
  });
});
