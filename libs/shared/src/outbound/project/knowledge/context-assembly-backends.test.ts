import { describe, it, expect } from "vitest";
import {
  labelledByBackend,
  utopiaAssemblyFor,
} from "./context-assembly-backends.js";

describe("utopiaAssemblyFor", () => {
  it("returns a block with no sections when Utopia cannot be read", () => {
    const assembled = utopiaAssemblyFor("deploys", { maxTokens: 4000 });

    expect(assembled).toEqual({
      text: [
        '<context query="deploys" template="default" budget="4000">',
        "",
        "</context>",
      ].join("\n"),
      sections: [],
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
