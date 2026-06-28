import { describe, it, expect } from "vitest";
import { InMemoryEpisodeRepository } from "./episodes.js";

describe("InMemoryEpisodeRepository.insert", () => {
  it("returns a synthetic id for a new episode", async () => {
    const repo = new InMemoryEpisodeRepository();
    const id = await repo.insert({
      agentId: "a",
      content: "body",
      contentHash: "h1",
      source: "ci",
      ref: "r",
    });
    expect(id).toBe("episode-1");
    expect(repo.rows).toHaveLength(1);
  });

  it("returns null on a duplicate agentId + contentHash", async () => {
    const repo = new InMemoryEpisodeRepository();
    const base = { agentId: "a", content: "body", contentHash: "h1", source: "ci", ref: "r" };
    await repo.insert(base);
    expect(await repo.insert(base)).toBeNull();
    expect(repo.rows).toHaveLength(1);
  });

  it("treats the same hash under a different agent as distinct", async () => {
    const repo = new InMemoryEpisodeRepository();
    await repo.insert({ agentId: "a", content: "b", contentHash: "h1", source: "ci", ref: "r" });
    const id = await repo.insert({ agentId: "b", content: "b", contentHash: "h1", source: "ci", ref: "r" });
    expect(id).toBe("episode-2");
  });
});
