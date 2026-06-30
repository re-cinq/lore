import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Llm, FakeLlm } from "@re-cinq/lore-shared";
import { InMemoryMemoryLifecycle } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-memory.js";
import type { MemoryLifecyclePort } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-port.js";
import {
  writeEpisode,
  writeEpisodeWithCuration,
  type WriteEpisodeDeps,
} from "./episode-writer.js";

describe("writeEpisode", () => {
  it("redacts secrets before storing the episode", async () => {
    const memory = new InMemoryMemoryLifecycle();
    await writeEpisode(
      `deploy token ghp_${"a".repeat(36)}`,
      "ci",
      "re-cinq/lore/1",
      "agent",
      { memory },
    );
    expect(memory.episodes[0].content).toContain("[REDACTED:api-key]");
    expect(memory.episodes[0].content).not.toContain("ghp_");
  });

  it("returns the episode id then null on a duplicate", async () => {
    const deps: WriteEpisodeDeps = { memory: new InMemoryMemoryLifecycle() };
    expect(await writeEpisode("same body", "ci", "r", "agent", deps)).toBe("episode-1");
    expect(await writeEpisode("same body", "ci", "r", "agent", deps)).toBeNull();
  });

  it("returns null instead of throwing when the store fails", async () => {
    const memory = {
      insertEpisode: async () => {
        throw new Error("db down");
      },
    } as unknown as MemoryLifecyclePort;
    expect(await writeEpisode("body", "ci", "r", "agent", { memory })).toBeNull();
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
    const memory = new InMemoryMemoryLifecycle();
    const fake = new FakeLlm({ text });
    Llm.setInstance(fake);
    return { memory, fake, deps: { memory } };
  };

  const curated = (memory: InMemoryMemoryLifecycle, key: string) =>
    memory.memories.find((m) => m.key === key);

  it("upserts a sanitized auto-curation memory for a real lesson", async () => {
    const d = deps("Always rebuild shared before the agent build.");
    await writeEpisodeWithCuration("outcome", "ci", "re-cinq/lore#42", "merge-check", "t1", d.deps);
    expect(curated(d.memory, "auto-curation/re-cinq/lore_42")).toMatchObject({
      agent_id: "merge-check",
      value: "Always rebuild shared before the agent build.",
    });
  });

  it("skips curation when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const d = deps("A lesson.");
    await writeEpisodeWithCuration("outcome", "ci", "r", "merge-check", "t1", d.deps);
    expect(d.fake.calls).toHaveLength(0);
    expect(d.memory.memories).toHaveLength(0);
    expect(d.memory.episodes).toHaveLength(1);
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
    expect(skip.memory.memories).toHaveLength(0);

    const short = deps("nope");
    await writeEpisodeWithCuration("outcome", "ci", "r2", "merge-check", "t1", short.deps);
    expect(short.memory.memories).toHaveLength(0);
  });
});
