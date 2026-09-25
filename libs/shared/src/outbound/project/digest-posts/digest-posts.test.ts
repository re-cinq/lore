import { describe, it, expect } from "vitest";
import { InMemoryDigestPosts } from "./digest-posts-memory.js";
import { PgDigestPosts } from "./digest-posts-pg.js";
import type { PgPool } from "../../memory-store.js";

const claimFor = (repo: string) => ({
  repo,
  channelId: "C1",
  weekKey: "2026-W39",
});

describe("InMemoryDigestPosts", () => {
  it("returns null for a channel with no thread this week", async () => {
    expect(await new InMemoryDigestPosts().threadFor("C1", "2026-W39")).toBe(
      null,
    );
  });

  it("returns the saved ts for the same channel and week once finished", async () => {
    const posts = new InMemoryDigestPosts();

    await posts.claim("run-1", [claimFor("re-cinq/lore")]);
    expect(await posts.threadFor("C1", "2026-W39")).toBe(null);
    await posts.finish("run-1", { threadTs: "1.1", intro: "Hi", ending: "Go" });

    expect(await posts.threadFor("C1", "2026-W39")).toEqual({
      threadTs: "1.1",
    });
  });

  it("returns the newest finished post time for a repo", async () => {
    let clock = new Date("2026-09-24T07:00:00Z");
    const posts = new InMemoryDigestPosts(() => clock);

    await posts.claim("run-1", [claimFor("re-cinq/lore")]);
    await posts.finish("run-1", { threadTs: "1.1", intro: "", ending: "" });
    clock = new Date("2026-09-25T07:00:00Z");
    await posts.claim("run-2", [claimFor("re-cinq/lore")]);

    expect(await posts.lastPostedAt("re-cinq/lore")).toEqual(
      new Date("2026-09-24T07:00:00Z"),
    );
  });

  it("returns the last intros and endings newest first, one per run", async () => {
    let clock = new Date("2026-09-24T07:00:00Z");
    const posts = new InMemoryDigestPosts(() => clock);

    await posts.claim("run-1", [
      claimFor("re-cinq/lore"),
      claimFor("re-cinq/otto"),
    ]);
    await posts.finish("run-1", {
      threadTs: "1.1",
      intro: "Old",
      ending: "Bye",
    });
    clock = new Date("2026-09-25T07:00:00Z");
    await posts.claim("run-2", [claimFor("re-cinq/lore")]);
    await posts.finish("run-2", {
      threadTs: "1.1",
      intro: "New",
      ending: "Go",
    });

    expect(await posts.recentTexts("C1", 14)).toEqual([
      { intro: "New", ending: "Go" },
      { intro: "Old", ending: "Bye" },
    ]);
  });

  it("lets only the first claim of a run through", async () => {
    const posts = new InMemoryDigestPosts();

    expect(await posts.claim("run-1", [claimFor("re-cinq/lore")])).toBe(true);
    expect(await posts.claim("run-1", [claimFor("re-cinq/lore")])).toBe(false);
  });

  it("forgets a released claim but keeps a finished post", async () => {
    const posts = new InMemoryDigestPosts();

    await posts.claim("run-1", [claimFor("re-cinq/lore")]);
    await posts.finish("run-1", { threadTs: "1.1", intro: "", ending: "" });
    await posts.claim("run-2", [claimFor("re-cinq/lore")]);
    await posts.release("run-2");
    await posts.release("run-1");

    expect(posts.rows.map((r) => r.runId)).toEqual(["run-1"]);
  });
});

function fakePool(rowsByCall: unknown[][] = []) {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ text, params });

      return { rows: (rowsByCall[calls.length - 1] ?? []) as T[] };
    },
  };

  return { pool, calls };
}

describe("PgDigestPosts", () => {
  it("claims every entry of a run in one insert that yields to an earlier claim", async () => {
    const { pool, calls } = fakePool([[{ run_id: "run-1" }]]);

    const claimed = await new PgDigestPosts(pool).claim("run-1", [
      claimFor("re-cinq/lore"),
      claimFor("re-cinq/otto"),
    ]);

    expect({ claimed, sql: calls[0]?.text, params: calls[0]?.params }).toEqual({
      claimed: true,
      sql: expect.stringContaining("ON CONFLICT DO NOTHING"),
      params: [
        "run-1",
        JSON.stringify([
          { repo: "re-cinq/lore", channel_id: "C1", week_key: "2026-W39" },
          { repo: "re-cinq/otto", channel_id: "C1", week_key: "2026-W39" },
        ]),
      ],
    });
  });

  it("reports a lost claim when the insert returned no row", async () => {
    const { pool } = fakePool([[]]);

    expect(
      await new PgDigestPosts(pool).claim("run-1", [claimFor("re-cinq/lore")]),
    ).toBe(false);
  });

  it("reads the watermark, the thread and the recent texts from finished rows only", async () => {
    const { pool, calls } = fakePool([[], [], []]);
    const posts = new PgDigestPosts(pool);

    await posts.lastPostedAt("re-cinq/lore");
    await posts.threadFor("C1", "2026-W39");
    await posts.recentTexts("C1", 14);

    expect(calls.map((c) => c.text.includes("thread_ts <> ''"))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("finishes a run's rows with the thread and texts, and releases only unfinished ones", async () => {
    const { pool, calls } = fakePool();
    const posts = new PgDigestPosts(pool);

    await posts.finish("run-1", { threadTs: "1.1", intro: "Hi", ending: "Go" });
    await posts.release("run-1");

    expect(calls.map((c) => c.params)).toEqual([
      ["run-1", "1.1", "Hi", "Go"],
      ["run-1"],
    ]);
    expect(calls[1]?.text).toContain("thread_ts = ''");
  });
});
