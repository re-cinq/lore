import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Llm } from "./llm/llm.js";
import { FakeLlm } from "./llm/fake-llm.js";
import { InMemoryMemoryLifecycle } from "./project/memory/memory-lifecycle-memory.js";
import type { MemoryLifecyclePort } from "./project/memory/memory-lifecycle-port.js";
import {
  writeEpisode,
  writeEpisodeWithCuration,
  type WriteEpisodeDeps,
} from "./episode-writer.js";

describe("writeEpisode", () => {
  it("redacts secrets before storing the episode", async () => {
    const memory = new InMemoryMemoryLifecycle();

    await writeEpisode(
      { memory },
      {
        content: `deploy token ghp_${"a".repeat(36)}`,
        source: "ci",
        ref: "re-cinq/lore/1",
        agentId: "agent",
      },
    );
    expect(memory.episodes[0].content).toContain("[REDACTED:api-key]");
    expect(memory.episodes[0].content).not.toContain("ghp_");
  });

  it("returns the episode id then null on a duplicate", async () => {
    const deps: WriteEpisodeDeps = { memory: new InMemoryMemoryLifecycle() };

    const episode = {
      content: "same body",
      source: "ci",
      ref: "r",
      agentId: "agent",
    };

    expect(await writeEpisode(deps, episode)).toBe("episode-1");
    expect(await writeEpisode(deps, episode)).toBeNull();
  });

  it("returns null instead of throwing when the store fails", async () => {
    const memory = {
      insertEpisode: async () => {
        throw new Error("db down");
      },
    } as unknown as MemoryLifecyclePort;

    expect(
      await writeEpisode(
        { memory },
        { content: "body", source: "ci", ref: "r", agentId: "agent" },
      ),
    ).toBeNull();
  });
});

describe("writeEpisodeWithCuration", () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    if (savedKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    }

    if (savedKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = savedKey;
    }
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

    await writeEpisodeWithCuration(d.deps, {
      content: "outcome",
      source: "ci",
      ref: "re-cinq/lore#42",
      agentId: "merge-check",
      taskId: "t1",
    });
    expect(curated(d.memory, "auto-curation/re-cinq/lore_42")).toMatchObject({
      agent_id: "merge-check",
      value: "Always rebuild shared before the agent build.",
    });
  });

  it("skips curation when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const d = deps("A lesson.");

    await writeEpisodeWithCuration(d.deps, {
      content: "outcome",
      source: "ci",
      ref: "r",
      agentId: "merge-check",
      taskId: "t1",
    });
    expect(d.fake.calls).toHaveLength(0);
    expect(d.memory.memories).toHaveLength(0);
    expect(d.memory.episodes).toHaveLength(1);
  });

  it("skips curation for a duplicate episode (no new id)", async () => {
    const d = deps("A real lesson learned.");

    await writeEpisodeWithCuration(d.deps, {
      content: "same",
      source: "ci",
      ref: "r",
      agentId: "merge-check",
      taskId: "t1",
    });
    await writeEpisodeWithCuration(d.deps, {
      content: "same",
      source: "ci",
      ref: "r",
      agentId: "merge-check",
      taskId: "t1",
    });
    expect(d.fake.calls).toHaveLength(1);
  });

  it("does not store a SKIP or too-short lesson", async () => {
    const skip = deps("SKIP");

    await writeEpisodeWithCuration(skip.deps, {
      content: "outcome",
      source: "ci",
      ref: "r1",
      agentId: "merge-check",
      taskId: "t1",
    });
    expect(skip.memory.memories).toHaveLength(0);

    const short = deps("nope");

    await writeEpisodeWithCuration(short.deps, {
      content: "outcome",
      source: "ci",
      ref: "r2",
      agentId: "merge-check",
      taskId: "t1",
    });
    expect(short.memory.memories).toHaveLength(0);
  });
});
