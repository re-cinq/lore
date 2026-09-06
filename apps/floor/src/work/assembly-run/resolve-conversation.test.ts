import { describe, it, expect } from "vitest";
import { InMemoryConversations } from "@re-cinq/lore-shared/project/conversations/conversations-memory.js";
import { resolveConversation } from "./resolve-conversation.js";
import type { FloorAssemblyRunTask } from "./floor-assembly-run.js";

const task: FloorAssemblyRunTask = {
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

    expect(
      await resolveConversation(
        node(),
        task,
        { iteration: 1, priorOutcome: null },
        deps(store),
      ),
    ).toEqual({
      source: "http://floor:8080/api/agent-conversations",
      id: "round-4",
      pin: "new-id",
      headersSecret: "agent-events-auth",
    });
  });

  it("starts fresh but still reserves a save id on the first round", async () => {
    const store = new InMemoryConversations();
    const result = await resolveConversation(
      node(),
      task,
      { iteration: 1, priorOutcome: null },
      deps(store),
    );

    expect(result).toMatchObject({ id: "", pin: "new-id" });
    expect(await store.byConversationId("new-id")).toBeTruthy();
  });

  it("forks rather than overwrites, so the continued run stays resumable", async () => {
    const store = new InMemoryConversations();

    await store.reserve({
      thread: { kind: "args", value: "feature-9", nodeId: "analyze" },
      conversationId: "round-4",
      assemblyLineId: "line-1",
    });
    await store.attachArchive("round-4", "k/round-4", 10);
    const result = await resolveConversation(
      node(),
      task,
      { iteration: 1, priorOutcome: null },
      deps(store),
    );

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
        { iteration: 1, priorOutcome: null },
        deps(new InMemoryConversations()),
      ),
    ).toBeUndefined();
  });

  it("never continues on a retry", async () => {
    const store = new InMemoryConversations();

    expect(
      await resolveConversation(
        node(),
        task,
        { iteration: 2, priorOutcome: "failed" },
        deps(store),
      ),
    ).toBeUndefined();
    expect(store.rows).toEqual([]);
  });

  it("declares nothing when the run cannot satisfy the thread key", async () => {
    const store = new InMemoryConversations();
    const bare = { ...task, args: {} };

    expect(
      await resolveConversation(
        node(),
        bare,
        { iteration: 1, priorOutcome: null },
        deps(store),
      ),
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

    expect(
      (
        await resolveConversation(
          node(),
          task,
          { iteration: 1, priorOutcome: null },
          deps(store),
        )
      )?.id,
    ).toBe("");
  });
});

describe("resolveConversation rewind", () => {
  const rewinding: FloorAssemblyRunTask = {
    ...task,
    assemblyLineId: "line-5",
    args: { feature_id: "feature-9", resume_from_task: "task-round-2" },
  };

  const withLines = (
    conversations: InMemoryConversations,
    lines: Record<string, string[]>,
  ) => ({
    ...deps(conversations),
    linesForTask: async (taskId: string) => lines[taskId] ?? [],
  });

  it("resumes the round the author rewound to, not the newest", async () => {
    const store = new InMemoryConversations();
    const thread = {
      kind: "args" as const,
      value: "feature-9",
      nodeId: "analyze",
    };

    for (const [line, id] of [
      ["line-2", "round-2"],
      ["line-4", "round-4"],
    ]) {
      await store.reserve({ thread, conversationId: id, assemblyLineId: line });
      await store.attachArchive(id, `k/${id}.tgz`, 10);
    }

    expect(
      await resolveConversation(
        node(),
        rewinding,
        { iteration: 1, priorOutcome: null },
        withLines(store, { "task-round-2": ["line-2"] }),
      ),
    ).toMatchObject({ id: "round-2" });
  });

  it("starts fresh rather than resuming the newest when the chosen round has no state", async () => {
    const store = new InMemoryConversations();
    const thread = {
      kind: "args" as const,
      value: "feature-9",
      nodeId: "analyze",
    };

    await store.reserve({
      thread,
      conversationId: "round-4",
      assemblyLineId: "line-4",
    });
    await store.attachArchive("round-4", "k/round-4.tgz", 10);

    expect(
      await resolveConversation(
        node(),
        rewinding,
        { iteration: 1, priorOutcome: null },
        withLines(store, { "task-round-2": ["line-2"] }),
      ),
    ).toMatchObject({ id: "" });
  });

  it("starts fresh when the chosen round never ran an assembly line", async () => {
    const store = new InMemoryConversations();

    expect(
      await resolveConversation(
        node(),
        rewinding,
        { iteration: 1, priorOutcome: null },
        withLines(store, {}),
      ),
    ).toMatchObject({ id: "" });
  });

  it("continues the newest when the run rewound to nothing", async () => {
    const store = new InMemoryConversations();
    const thread = {
      kind: "args" as const,
      value: "feature-9",
      nodeId: "analyze",
    };

    await store.reserve({
      thread,
      conversationId: "round-4",
      assemblyLineId: "line-4",
    });
    await store.attachArchive("round-4", "k/round-4.tgz", 10);

    expect(
      await resolveConversation(
        node(),
        task,
        { iteration: 1, priorOutcome: null },
        withLines(store, {}),
      ),
    ).toMatchObject({ id: "round-4" });
  });
});

describe("a line whose rounds are revisits of one node", () => {
  const thread = {
    kind: "args" as const,
    value: "feature-9",
    nodeId: "analyze",
  };

  const savedRound = async (
    store: InMemoryConversations,
    iteration: number,
  ) => {
    await store.reserve({
      thread,
      conversationId: `round-${iteration}`,
      assemblyLineId: task.assemblyLineId,
      iteration,
    });
    await store.attachArchive(`round-${iteration}`, `k/round-${iteration}`, 10);
  };

  it("continues the previous round even though it ran on this same line", async () => {
    const store = new InMemoryConversations();

    await savedRound(store, 1);

    expect(
      (
        await resolveConversation(
          node(),
          task,
          { iteration: 2, priorOutcome: null },
          deps(store),
        )
      )?.id,
    ).toBe("round-1");
  });

  it("never resumes the round it is itself re-running", async () => {
    const store = new InMemoryConversations();

    await savedRound(store, 2);

    expect(
      (
        await resolveConversation(
          node(),
          task,
          { iteration: 2, priorOutcome: null },
          deps(store),
        )
      )?.id,
    ).toBe("");
  });

  it("rewinds to the round the author picked by its iteration", async () => {
    const store = new InMemoryConversations();

    await savedRound(store, 1);
    await savedRound(store, 2);
    await savedRound(store, 3);

    const rewound = {
      ...task,
      args: { feature_id: "feature-9", resume_from_iteration: 1 },
    };

    expect(
      (
        await resolveConversation(
          node(),
          rewound,
          { iteration: 4, priorOutcome: null },
          deps(store),
        )
      )?.id,
    ).toBe("round-1");
  });

  it("starts fresh when the round the author picked saved nothing", async () => {
    const store = new InMemoryConversations();

    await savedRound(store, 1);
    const rewound = {
      ...task,
      args: { feature_id: "feature-9", resume_from_iteration: 9 },
    };

    expect(
      (
        await resolveConversation(
          node(),
          rewound,
          { iteration: 4, priorOutcome: null },
          deps(store),
        )
      )?.id,
    ).toBe("");
  });
});

describe("a rewind target whose task ran more than one line", () => {
  const rewinding: FloorAssemblyRunTask = {
    ...task,
    args: { feature_id: "feature-9", resume_from_task: "task-round-2" },
  };

  it("resumes line-4 when linesForTask answers newest-first ['line-4','line-2']", async () => {
    const store = new InMemoryConversations();
    const thread = {
      kind: "args" as const,
      value: "feature-9",
      nodeId: "analyze",
    };

    for (const [line, id] of [
      ["line-2", "round-2"],
      ["line-4", "round-4"],
    ]) {
      await store.reserve({ thread, conversationId: id, assemblyLineId: line });
      await store.attachArchive(id, `k/${id}.tgz`, 10);
    }

    expect(
      await resolveConversation(
        node(),
        rewinding,
        { iteration: 1, priorOutcome: null },
        {
          ...deps(store),
          linesForTask: async () => ["line-4", "line-2"],
        },
      ),
    ).toMatchObject({ id: "round-4" });
  });
});
