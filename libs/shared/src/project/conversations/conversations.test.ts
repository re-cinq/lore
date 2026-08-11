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
    // Offering it would send the next pod after an object that does not exist —
    // and a failed fetch is silent by design, so it would look like a fresh start.
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
      await store.latestFor(thread, { excludeAssemblyLineId: "l1" }),
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
