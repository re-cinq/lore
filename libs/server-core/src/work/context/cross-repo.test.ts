import { describe, it, expect } from "vitest";
import type { Pool } from "pg";
import { repoContextSettings } from "./cross-repo.js";

const poolWith = (settings: unknown) =>
  ({ query: async () => ({ rows: [{ settings }] }) }) as unknown as Pool;

describe("repoContextSettings", () => {
  it("returns the Utopia mirror kb-1 / src-docs when settings.utopia names the knowledge base and the docs source", async () => {
    const settings = await repoContextSettings(
      poolWith({
        context_backend: "both",
        utopia: {
          kb_id: "kb-1",
          docs_source_id: "src-docs",
          ontology_version: 3,
        },
      }),
      "re-cinq/lore",
    );

    expect(settings).toEqual({
      crossRepo: false,
      contextBackend: "both",
      utopiaMirror: { kbId: "kb-1", docsSourceId: "src-docs" },
    });
  });

  it("returns no Utopia mirror when settings.utopia names no docs source yet", async () => {
    const settings = await repoContextSettings(
      poolWith({ utopia: { kb_id: "kb-1" } }),
      "re-cinq/lore",
    );

    expect(settings).toEqual({ crossRepo: false });
  });
});
