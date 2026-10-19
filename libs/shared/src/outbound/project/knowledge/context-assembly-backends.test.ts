import { describe, it, expect } from "vitest";
import {
  labelledByBackend,
  utopiaAssembly,
} from "./context-assembly-backends.js";

describe("utopiaAssembly", () => {
  it("returns one no-reader section per template source instead of any stored data", () => {
    const assembled = utopiaAssembly(
      { query: "deploys", template: "default", budget: 4000 },
      [
        { header: "Conventions", source: "repo", priority: 1 },
        { header: "Agent Memory", source: "memories", priority: 2 },
      ],
    );

    expect(assembled).toEqual({
      text: [
        '<context query="deploys" template="default" budget="4000">',
        '<section name="Conventions" source="repo" priority="1">',
        '<document tokens="7">',
        "repo: no Utopia reader yet",
        "</document>",
        "</section>",
        '<section name="Agent Memory" source="memories" priority="2">',
        '<document tokens="8">',
        "memories: no Utopia reader yet",
        "</document>",
        "</section>",
        "</context>",
      ].join("\n"),
      sections: [
        { header: "Conventions", tokens: 7, truncated: false },
        { header: "Agent Memory", tokens: 8, truncated: false },
      ],
    });
  });
});

describe("labelledByBackend", () => {
  it("returns Lore's block then Utopia's, each wrapped and each section header prefixed with its backend", () => {
    const lore = {
      text: "<context>lore</context>",
      sections: [{ header: "Conventions", tokens: 40, truncated: true }],
      context_refs: { fact_ids: ["f1"], memory_ids: [] },
    };
    const utopia = {
      text: "<context>utopia</context>",
      sections: [{ header: "Conventions", tokens: 6, truncated: false }],
    };

    expect(labelledByBackend(lore, utopia)).toEqual({
      text: [
        '<backend name="lore">',
        "<context>lore</context>",
        "</backend>",
        '<backend name="utopia">',
        "<context>utopia</context>",
        "</backend>",
      ].join("\n"),
      sections: [
        { header: "lore: Conventions", tokens: 40, truncated: true },
        { header: "utopia: Conventions", tokens: 6, truncated: false },
      ],
      context_refs: { fact_ids: ["f1"], memory_ids: [] },
    });
  });
});
