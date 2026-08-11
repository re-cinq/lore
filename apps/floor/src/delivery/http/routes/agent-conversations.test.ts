import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InMemoryArchive } from "@re-cinq/lore-shared/project/archive/archive-memory.js";
import { InMemoryConversations } from "@re-cinq/lore-shared/project/conversations/conversations-memory.js";
import { buildServer } from "../server.js";

const store = new InMemoryConversations();
let archive: InMemoryArchive | null = new InMemoryArchive();

vi.mock("../../../kernel/queues.js", () => ({
  usage: () => ({ logLlmCall: vi.fn() }),
  agentRunEvents: () => ({ insertBatch: vi.fn() }),
  auditLog: () => ({ write: vi.fn() }),
  conversations: () => store,
}));

vi.mock("../../../kernel/archives.js", () => ({
  agentEventsArchive: () => archive,
}));

const ORIG = process.env.LORE_AGENT_INTERNAL_TOKEN;
const auth = { authorization: "Bearer test-internal" };
const server = () => buildServer({ getJobStatus: () => ({}) });

// A gzip archive, not text: the whole point is that a transcript survives the round
// trip byte-for-byte.
const GZIP = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03]);

beforeEach(() => {
  process.env.LORE_AGENT_INTERNAL_TOKEN = "test-internal";
  store.rows.length = 0;
  archive = new InMemoryArchive();
});

afterEach(() => {
  process.env.LORE_AGENT_INTERNAL_TOKEN = ORIG;
});

describe("POST /api/agent-conversations/{id}", () => {
  it("stores the archive and indexes it against the reserved id", async () => {
    await store.reserve({
      thread: { kind: "args", value: "feature-1", nodeId: "analyze" },
      conversationId: "conv-1",
      assemblyLineId: "line-1",
    });

    const res = await server().inject({
      method: "POST",
      url: "/api/agent-conversations/conv-1",
      headers: auth,
      payload: GZIP,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toMatchObject({
      status: "ok",
      indexed: true,
    });
    expect((await store.byConversationId("conv-1"))?.objectKey).toBe(
      "agent-conversations/conv-1.tgz",
    );
  });

  it("still accepts an archive for an id nobody reserved", async () => {
    // The run produced real work; refusing it would lose the transcript over a
    // bookkeeping mismatch.
    const res = await server().inject({
      method: "POST",
      url: "/api/agent-conversations/stray",
      headers: auth,
      payload: GZIP,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).indexed).toBe(false);
  });

  it("accepts the save as a no-op when no bucket is configured", async () => {
    // A laptop without object storage: the run still succeeded, and the only cost
    // is that the next one starts fresh.
    archive = null;

    const res = await server().inject({
      method: "POST",
      url: "/api/agent-conversations/conv-1",
      headers: auth,
      payload: GZIP,
    });

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.payload).status).toBe("skipped");
  });

  it("refuses an unauthenticated save", async () => {
    const res = await server().inject({
      method: "POST",
      url: "/api/agent-conversations/conv-1",
      payload: GZIP,
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/agent-conversations/{id}", () => {
  it("returns the archive bytes unchanged", async () => {
    await store.reserve({
      thread: { kind: "args", value: "feature-1", nodeId: "analyze" },
      conversationId: "conv-1",
      assemblyLineId: "line-1",
    });
    await server().inject({
      method: "POST",
      url: "/api/agent-conversations/conv-1",
      headers: auth,
      payload: GZIP,
    });

    const res = await server().inject({
      method: "GET",
      url: "/api/agent-conversations/conv-1",
      headers: auth,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/gzip");
    expect(Buffer.from(res.rawPayload).equals(GZIP)).toBe(true);
  });

  it("404s a conversation that was reserved but never uploaded", async () => {
    await store.reserve({
      thread: { kind: "args", value: "feature-1", nodeId: "analyze" },
      conversationId: "conv-1",
      assemblyLineId: "line-1",
    });

    const res = await server().inject({
      method: "GET",
      url: "/api/agent-conversations/conv-1",
      headers: auth,
    });

    expect(res.statusCode).toBe(404);
  });

  it("404s an unknown conversation rather than erroring", async () => {
    const res = await server().inject({
      method: "GET",
      url: "/api/agent-conversations/nope",
      headers: auth,
    });

    expect(res.statusCode).toBe(404);
  });

  it("refuses an unauthenticated fetch", async () => {
    const res = await server().inject({
      method: "GET",
      url: "/api/agent-conversations/conv-1",
    });

    expect(res.statusCode).toBe(401);
  });
});
