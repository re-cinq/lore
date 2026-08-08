import { describe, it, expect, vi, afterEach } from "vitest";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

vi.mock("@re-cinq/lore-server-core/features/memory/facts.js", () => ({
  extractFacts: vi.fn(async () => undefined),
}));

import { extractFacts } from "@re-cinq/lore-server-core/features/memory/facts.js";
import { extractFactsForMemory } from "./fact-extraction.js";

afterEach(() => vi.clearAllMocks());

describe("extractFactsForMemory", () => {
  it("extracts from the newest version of the written memory", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ id: "m-1" }] });
    await extractFactsForMemory(pool as never, {
      key: "conventions/naming",
      value: "we use kebab-case",
      agentId: "agent-7",
      repo: "o/r",
    });

    const [sql, params] = pool.query.mock.calls[0];

    expect(String(sql)).toContain("ORDER BY version DESC");
    expect(params).toEqual(["conventions/naming", "o/r", "agent-7"]);
    expect(extractFacts).toHaveBeenCalledWith(
      "m-1",
      "we use kebab-case",
      pool,
    );
  });

  it("does nothing when the written memory cannot be resolved", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    await extractFactsForMemory(pool as never, {
      key: "k",
      value: "v",
      agentId: "agent-7",
    });

    expect(extractFacts).not.toHaveBeenCalled();
  });

  it("swallows a lookup failure so the write still succeeds", async () => {
    const pool = makePool();

    pool.query.mockRejectedValue(new Error("connection lost"));

    await expect(
      extractFactsForMemory(pool as never, {
        key: "k",
        value: "v",
        agentId: "agent-7",
      }),
    ).resolves.toBeUndefined();
    expect(extractFacts).not.toHaveBeenCalled();
  });
});
