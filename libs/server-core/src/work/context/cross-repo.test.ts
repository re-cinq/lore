import { describe, it, expect } from "vitest";
import type { Pool } from "pg";
import { repoContextSettings } from "./cross-repo.js";

const poolWith = (settings: unknown) =>
  ({ query: async () => ({ rows: [{ settings }] }) }) as unknown as Pool;

describe("repoContextSettings", () => {
  it("returns the Utopia mirror kb-1 / src-1 when settings.utopia names both", async () => {
    const settings = await repoContextSettings(
      poolWith({
        context_backend: "both",
        utopia: { kb_id: "kb-1", source_id: "src-1", ontology_version: 3 },
      }),
      "re-cinq/lore",
    );

    expect(settings).toEqual({
      crossRepo: false,
      contextBackend: "both",
      utopiaMirror: { kbId: "kb-1", statementsSourceId: "src-1" },
    });
  });

  it("returns no Utopia mirror when settings.utopia lacks a source id", async () => {
    const settings = await repoContextSettings(
      poolWith({ utopia: { kb_id: "kb-1" } }),
      "re-cinq/lore",
    );

    expect(settings).toEqual({ crossRepo: false });
  });
});
