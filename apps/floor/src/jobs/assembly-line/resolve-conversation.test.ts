import { describe, it, expect } from "vitest";
import { InMemoryConversations } from "@re-cinq/lore-shared/project/conversations/conversations-memory.js";
import { resolveConversation } from "./resolve-conversation.js";
import type { FloorAssemblyLineTask } from "./floor-assembly-line.js";

const task: FloorAssemblyLineTask = {
  taskId: "task-1",
  pipelineTaskId: "task-1",
  assemblyLineId: "line-2",
  taskType: "feature-planning",
  description: "plan it",
  targetRepo: "re-cinq/lore",
  branch: "lore/x",
  args: { feature_id: "feature-9" },
};

const node = (over: Record<string, unknown> = {}) =>
  ({
    id: "analyze",
    type: "agent",
    continues: { node: "analyze", key: "args.feature_id" },
    ...over,
  }) as never;

const deps = (conversations: InMemoryConversations, id = "new-id") => ({
  conversations,
  registryUrl: "http://floor:8080/api/agent-conversations",
  headersSecret: "agent-events-auth",
  newId: () => id,
});

describe("resolveConversation", () => {
  it("continues the thread's newest conversation and saves as a new id", async () => {
    const store = new InMemoryConversations();

    await store.reserve({
      thread: { kind: "args", value: "feature-9", nodeId: "analyze" },
      conversationId: "round-4",
      assemblyLineId: "line-1",
    });
    await store.attachArchive("round-4", "k/round-4", 10);

    expect(await resolveConversation(node(), task, 1, deps(store))).toEqual({
      source: "http://floor:8080/api/agent-conversations",
      id: "round-4",
      pin: "new-id",
      headersSecret: "agent-events-auth",
    });
  });

  it("starts fresh but still reserves a save id on the first round", async () => {
    const store = new InMemoryConversations();
    const result = await resolveConversation(node(), task, 1, deps(store));

    expect(result).toMatchObject({ id: "", pin: "new-id" });
    expect(await store.byConversationId("new-id")).toBeTruthy();
  });

  it("forks rather than overwrites, so the continued run stays resumable", async () => {
    // The pin is always NEW — that is what lets an author rewind to an earlier round
    // after later ones have run.
    const store = new InMemoryConversations();

    await store.reserve({
      thread: { kind: "args", value: "feature-9", nodeId: "analyze" },
      conversationId: "round-4",
      assemblyLineId: "line-1",
    });
    await store.attachArchive("round-4", "k/round-4", 10);
    const result = await resolveConversation(node(), task, 1, deps(store));

    expect(result?.pin).not.toBe(result?.id);
    expect((await store.byConversationId("round-4"))?.objectKey).toBe(
      "k/round-4",
    );
  });

  it("declares nothing for a node that continues nothing", async () => {
    expect(
      await resolveConversation(
        node({ continues: undefined }),
        task,
        1,
        deps(new InMemoryConversations()),
      ),
    ).toBeUndefined();
  });

  it("never continues on a retry", async () => {
    const store = new InMemoryConversations();

    expect(
      await resolveConversation(node(), task, 2, deps(store)),
    ).toBeUndefined();
    // And reserves nothing, so a retry leaves no orphan id behind.
    expect(store.rows).toEqual([]);
  });

  it("declares nothing when the run cannot satisfy the thread key", async () => {
    const store = new InMemoryConversations();
    const bare = { ...task, args: {} };

    expect(
      await resolveConversation(node(), bare, 1, deps(store)),
    ).toBeUndefined();
    expect(store.rows).toEqual([]);
  });

  it("never resumes the line's own conversation", async () => {
    const store = new InMemoryConversations();

    await store.reserve({
      thread: { kind: "args", value: "feature-9", nodeId: "analyze" },
      conversationId: "mine",
      assemblyLineId: "line-2",
    });
    await store.attachArchive("mine", "k/mine", 10);

    expect((await resolveConversation(node(), task, 1, deps(store)))?.id).toBe(
      "",
    );
  });
});
