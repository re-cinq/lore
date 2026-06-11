import { describe, it, expect, vi } from "vitest";

vi.mock("../../embeddings/embedding-service.js", () => ({
  getQueryEmbedding: vi.fn(async () => null),
}));

import { getQueryEmbedding } from "../../embeddings/embedding-service.js";
import { fitItemsToBudget, hybridChunkItems } from "./context-assembly.js";

const item = (tokens: number, path: string) => ({ text: "x".repeat(tokens * 4), tokens, source_path: path });

describe("fitItemsToBudget per-document cap", () => {
  it("caps a single oversized document so smaller documents still fit", () => {
    const items = [item(1000, "big.md"), item(100, "a.md"), item(100, "b.md")];

    const { items: kept, truncated } = fitItemsToBudget(items as never, 1000, 400);

    expect((kept as Array<{ source_path: string }>).map((i) => i.source_path)).toEqual(["big.md", "a.md", "b.md"]);
    expect(kept[0].tokens).toBeLessThanOrEqual(400);
    expect(truncated).toBe(true);
  });

  it("without a cap, one big document fills the budget and crowds out the rest", () => {
    const items = [item(1000, "big.md"), item(100, "a.md")];

    const { items: kept } = fitItemsToBudget(items as never, 1000);

    expect((kept as Array<{ source_path: string }>).map((i) => i.source_path)).toEqual(["big.md"]);
  });
});

describe("hybridChunkItems", () => {
  it("retrieves chunks bound to the repo + content types (keyword path when no embedding)", async () => {
    vi.mocked(getQueryEmbedding).mockResolvedValueOnce(null);
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const pool = {
      query: async (text: string, params?: unknown[]) => {
        calls.push({ text, params });
        return { rows: [{ content: "export function parseSettingsForm() {}", file_path: "web-ui/src/lib/settings-form.ts", content_type: "code", score: 0.42 }] };
      },
    };

    const items = await hybridChunkItems(pool, "settings form parser", "re-cinq/lore", ["code"], 6);

    expect(calls[0].params?.[0]).toBe("re-cinq/lore");
    expect(calls[0].params).toContainEqual(["code"]);
    expect(items[0]).toMatchObject({ source_path: "web-ui/src/lib/settings-form.ts", content_type: "code" });
    expect(items[0].text).toContain("parseSettingsForm");
  });

  it("uses a vector+keyword RRF query when an embedding is available", async () => {
    vi.mocked(getQueryEmbedding).mockResolvedValueOnce([0.1, 0.2, 0.3]);
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const pool = {
      query: async (text: string, params?: unknown[]) => {
        calls.push({ text, params });
        return { rows: [{ content: "code", file_path: "a.ts", content_type: "code", score: 0.5 }] };
      },
    };

    await hybridChunkItems(pool, "q", "re-cinq/lore", ["code"], 6);

    expect(calls[0].text).toContain("embedding <=>");
    expect(calls[0].params).toContainEqual("[0.1,0.2,0.3]");
  });
});
