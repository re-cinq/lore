import { afterEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { answerScope, contextBuilderFor } from "./context-builder-deps.js";

function savedSettings(saved: Record<string, string>): Pool {
  return {
    query: async () => ({
      rows: Object.entries(saved).map(([key, value]) => ({ key, value })),
    }),
  } as unknown as Pool;
}

const request = {
  repo: "re-cinq/lore",
  query: "how the loop rebases",
  maxTokens: 8000,
  crossRepoRequested: false,
};

describe("contextBuilderFor", () => {
  afterEach(() => {
    delete process.env.LORE_CONTEXT_LLM_PROVIDER;
  });

  it("builds when the settings page names vertex and the env names nothing", async () => {
    const builder = await contextBuilderFor(
      savedSettings({ context_llm_provider: "vertex" }),
      request,
    );

    expect(typeof builder).toBe("function");
  });

  it("leaves lore-v2 on the template assembly when the settings page says off over an env naming vertex", async () => {
    process.env.LORE_CONTEXT_LLM_PROVIDER = "vertex";

    expect(
      await contextBuilderFor(
        savedSettings({ context_llm_provider: "off" }),
        request,
      ),
    ).toBeNull();
  });

  it("leaves a request that names no repository on the template assembly", async () => {
    expect(
      await contextBuilderFor(
        savedSettings({ context_llm_provider: "vertex" }),
        { ...request, repo: "" },
      ),
    ).toBeNull();
  });
});

describe("answerScope", () => {
  const poolWith = (settings: unknown) =>
    ({ query: async () => ({ rows: [{ settings }] }) }) as unknown as Pool;

  it("answers a repository's questions over utopia when its settings name no store", async () => {
    const scope = await answerScope(poolWith({}), "re-cinq/lore");

    expect(scope.backend).toBe("utopia");
  });

  it("answers a repository's questions over lore when its settings say context_backend lore", async () => {
    const scope = await answerScope(
      poolWith({ context_backend: "lore" }),
      "re-cinq/lore",
    );

    expect(scope.backend).toBe("lore");
  });
});
