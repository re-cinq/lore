import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Llm, FakeLlm } from "@re-cinq/lore-shared";
import {
  writeEpisode,
  writeEpisodeWithCuration,
  type WriteEpisodeDeps,
} from "./episode-writer.js";
import {
  InMemoryEpisodeRepository,
  InMemoryMemoryRepository,
  memoryRowKey,
  type EpisodeRepository,
} from "../repositories/index.js";

describe("writeEpisode", () => {
  it("redacts secrets before storing the episode", async () => {
    const episodes = new InMemoryEpisodeRepository();
    await writeEpisode(
      `deploy token ghp_${"a".repeat(36)}`,
      "ci",
      "re-cinq/lore/1",
      "agent",
      { episodes },
    );
    expect(episodes.rows[0].content).toContain("[REDACTED:api-key]");
    expect(episodes.rows[0].content).not.toContain("ghp_");
  });

  it("returns the episode id then null on a duplicate", async () => {
    const episodes = new InMemoryEpisodeRepository();
    const deps: WriteEpisodeDeps = { episodes };
    expect(await writeEpisode("same body", "ci", "r", "agent", deps)).toBe("episode-1");
    expect(await writeEpisode("same body", "ci", "r", "agent", deps)).toBeNull();
  });

  it("returns null instead of throwing when the repository fails", async () => {
    const episodes: EpisodeRepository = {
      insert: async () => {
        throw new Error("db down");
      },
    };
    expect(await writeEpisode("body", "ci", "r", "agent", { episodes })).toBeNull();
  });
});

describe("writeEpisodeWithCuration", () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
    Llm.reset();
  });

  const deps = (text: string) => {
    const episodes = new InMemoryEpisodeRepository();
    const memories = new InMemoryMemoryRepository();
    const fake = new FakeLlm({ text });
    Llm.setInstance(fake);
    return { episodes, memories, fake, deps: { episodes, memories } };
  };

  it("upserts a sanitized auto-curation memory for a real lesson", async () => {
    const d = deps("Always rebuild shared before the agent build.");
    await writeEpisodeWithCuration("outcome", "ci", "re-cinq/lore#42", "merge-check", "t1", d.deps);
    expect(
      d.memories.rows.get(memoryRowKey("merge-check", "auto-curation/re-cinq/lore_42")),
    ).toMatchObject({
      value: "Always rebuild shared before the agent build.",
    });
  });

  it("skips curation when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const d = deps("A lesson.");
    await writeEpisodeWithCuration("outcome", "ci", "r", "merge-check", "t1", d.deps);
    expect(d.fake.calls).toHaveLength(0);
    expect(d.memories.rows.size).toBe(0);
    expect(d.episodes.rows).toHaveLength(1);
  });

  it("skips curation for a duplicate episode (no new id)", async () => {
    const d = deps("A real lesson learned.");
    await writeEpisodeWithCuration("same", "ci", "r", "merge-check", "t1", d.deps);
    await writeEpisodeWithCuration("same", "ci", "r", "merge-check", "t1", d.deps);
    expect(d.fake.calls).toHaveLength(1);
  });

  it("does not store a SKIP or too-short lesson", async () => {
    const skip = deps("SKIP");
    await writeEpisodeWithCuration("outcome", "ci", "r1", "merge-check", "t1", skip.deps);
    expect(skip.memories.rows.size).toBe(0);

    const short = deps("nope");
    await writeEpisodeWithCuration("outcome", "ci", "r2", "merge-check", "t1", short.deps);
    expect(short.memories.rows.size).toBe(0);
  });
});
