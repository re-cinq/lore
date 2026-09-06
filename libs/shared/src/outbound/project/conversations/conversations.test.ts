import { describe, it, expect } from "vitest";
import { InMemoryConversations } from "./conversations-memory.js";
import type { ConversationThread } from "./conversations-port.js";

const thread: ConversationThread = {
  kind: "args",
  value: "feature-1",
  nodeId: "analyze",
};

describe("ConversationsPort", () => {
  it("offers nothing for a thread that has never run", async () => {
    expect(await new InMemoryConversations().latestFor(thread)).toBeNull();
  });

  it("offers the newest saved conversation for a thread", async () => {
    const store = new InMemoryConversations();

    await store.reserve({ thread, conversationId: "c1", assemblyLineId: "l1" });
    await store.attachArchive("c1", "key/c1", 10);
    await store.reserve({ thread, conversationId: "c2", assemblyLineId: "l2" });
    await store.attachArchive("c2", "key/c2", 20);

    expect((await store.latestFor(thread))?.conversationId).toBe("c2");
  });

  it("skips a reserved conversation whose run never uploaded", async () => {
    const store = new InMemoryConversations();

    await store.reserve({ thread, conversationId: "c1", assemblyLineId: "l1" });
    await store.attachArchive("c1", "key/c1", 10);
    await store.reserve({ thread, conversationId: "c2", assemblyLineId: "l2" });

    expect((await store.latestFor(thread))?.conversationId).toBe("c1");
  });

  it("never offers a run its own conversation", async () => {
    const store = new InMemoryConversations();

    await store.reserve({ thread, conversationId: "c1", assemblyLineId: "l1" });
    await store.attachArchive("c1", "key/c1", 10);

    expect(
      await store.latestFor(thread, { exclude: { assemblyLineId: "l1" } }),
    ).toBeNull();
  });

  it("keeps threads apart, so one feature never continues another's", async () => {
    const store = new InMemoryConversations();
    const other = { ...thread, value: "feature-2" };

    await store.reserve({ thread, conversationId: "c1", assemblyLineId: "l1" });
    await store.attachArchive("c1", "key/c1", 10);

    expect(await store.latestFor(other)).toBeNull();
  });

  it("keeps nodes apart within one thread", async () => {
    const store = new InMemoryConversations();

    await store.reserve({ thread, conversationId: "c1", assemblyLineId: "l1" });
    await store.attachArchive("c1", "key/c1", 10);

    expect(await store.latestFor({ ...thread, nodeId: "review" })).toBeNull();
  });

  it("reports an archive attached to an unknown id", async () => {
    expect(
      await new InMemoryConversations().attachArchive("nope", "k", 1),
    ).toBe(false);
  });

  it("resolves a conversation by the id the pod was told to save as", async () => {
    const store = new InMemoryConversations();

    await store.reserve({ thread, conversationId: "c1", assemblyLineId: "l1" });

    expect((await store.byConversationId("c1"))?.objectKey).toBeNull();
    expect(await store.byConversationId("missing")).toBeNull();
  });
});

describe("ConversationsPort rewind", () => {
  const thread = {
    kind: "args" as const,
    value: "feature-9",
    nodeId: "analyze",
  };

  it("resumes the round the author chose, not the newest one", async () => {
    const conversations = new InMemoryConversations();

    for (const [line, id] of [
      ["line-2", "round-2"],
      ["line-3", "round-3"],
      ["line-4", "round-4"],
    ]) {
      await conversations.reserve({
        thread,
        conversationId: id,
        assemblyLineId: line,
      });
      await conversations.attachArchive(id, `k/${id}.tgz`, 10);
    }

    expect(
      await conversations.latestFor(thread, {
        from: { assemblyLineId: "line-2" },
      }),
    ).toMatchObject({ conversationId: "round-2" });
  });

  it("offers nothing when the chosen round never uploaded its state", async () => {
    const conversations = new InMemoryConversations();

    await conversations.reserve({
      thread,
      conversationId: "round-2",
      assemblyLineId: "line-2",
    });
    await conversations.reserve({
      thread,
      conversationId: "round-4",
      assemblyLineId: "line-4",
    });
    await conversations.attachArchive("round-4", "k/round-4.tgz", 10);

    expect(
      await conversations.latestFor(thread, {
        from: { assemblyLineId: "line-2" },
      }),
    ).toBeNull();
  });

  it("offers nothing when the chosen round belongs to another thread", async () => {
    const conversations = new InMemoryConversations();

    await conversations.reserve({
      thread: { kind: "args", value: "feature-OTHER", nodeId: "analyze" },
      conversationId: "round-2",
      assemblyLineId: "line-2",
    });
    await conversations.attachArchive("round-2", "k/round-2.tgz", 10);

    expect(
      await conversations.latestFor(thread, {
        from: { assemblyLineId: "line-2" },
      }),
    ).toBeNull();
  });
});

describe("a thread whose rounds share one assembly line", () => {
  const execution = (iteration: number) => ({
    assemblyLineId: "line-1",
    iteration,
  });

  it("offers round 1 to round 2 even though both ran on the same line", async () => {
    const store = new InMemoryConversations();

    await store.reserve({
      thread,
      conversationId: "round-1",
      assemblyLineId: "line-1",
      iteration: 1,
    });
    await store.attachArchive("round-1", "key/round-1", 10);

    expect(
      (await store.latestFor(thread, { exclude: execution(2) }))
        ?.conversationId,
    ).toBe("round-1");
  });

  it("never offers a run its own reserved conversation", async () => {
    const store = new InMemoryConversations();

    await store.reserve({
      thread,
      conversationId: "round-2",
      assemblyLineId: "line-1",
      iteration: 2,
    });
    await store.attachArchive("round-2", "key/round-2", 10);

    expect(await store.latestFor(thread, { exclude: execution(2) })).toBeNull();
  });

  it("rewinds to one round of a shared line by its iteration", async () => {
    const store = new InMemoryConversations();

    for (const n of [1, 2, 3]) {
      await store.reserve({
        thread,
        conversationId: `round-${n}`,
        assemblyLineId: "line-1",
        iteration: n,
      });
      await store.attachArchive(`round-${n}`, `key/round-${n}`, 10);
    }

    expect(
      (await store.latestFor(thread, { from: execution(2) }))?.conversationId,
    ).toBe("round-2");
  });

  it("offers nothing when the rewound-to round of a shared line never saved", async () => {
    const store = new InMemoryConversations();

    await store.reserve({
      thread,
      conversationId: "round-1",
      assemblyLineId: "line-1",
      iteration: 1,
    });
    await store.attachArchive("round-1", "key/round-1", 10);

    expect(await store.latestFor(thread, { from: execution(9) })).toBeNull();
  });
});

describe("a row written before conversations carried an iteration", () => {
  const preMigration = async (store: InMemoryConversations) => {
    await store.reserve({
      thread,
      conversationId: "legacy",
      assemblyLineId: "line-1",
    });
    await store.attachArchive("legacy", "key/legacy", 10);
  };

  it("hides it from the first execution, which is the one that could have written it", async () => {
    const store = new InMemoryConversations();

    await preMigration(store);

    expect(
      await store.latestFor(thread, {
        exclude: { assemblyLineId: "line-1", iteration: 1 },
      }),
    ).toBeNull();
  });

  it("offers it to a later round of the same line", async () => {
    const store = new InMemoryConversations();

    await preMigration(store);

    expect(
      (
        await store.latestFor(thread, {
          exclude: { assemblyLineId: "line-1", iteration: 3 },
        })
      )?.conversationId,
    ).toBe("legacy");
  });
});
