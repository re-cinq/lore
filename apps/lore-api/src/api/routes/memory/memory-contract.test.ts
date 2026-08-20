import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryOperationSchema as Schema } from "./memory.js";

/**
 * The declared union is documentation — `zodResponse` never validates a response
 * at runtime, so nothing else holds the six members to what the endpoint really
 * answers. This does: it drives every action against the real file-backed store
 * and parses the answer through the same schema the document publishes.
 *
 * The pool path is held to the same schema by
 * `src/integration-tests/memory-contract.test.ts`, which runs against a migrated
 * Postgres. Both are needed — the two backends answer the same endpoint, and a
 * contract only one of them satisfies is still a lie half the time.
 *
 * Responses go through a JSON round-trip first, because that is what a caller
 * receives: hapi serializes, and a `Date` the driver returned reaches the wire
 * as a string.
 *
 * memory-file.ts captures BASE_DIR = $HOME/.lore/memory at module-load time, so
 * HOME is pointed at a throwaway dir before the modules load. BOTH imports are
 * dynamic for that reason: a static `import` of the route module is hoisted
 * above every statement here, pulls memory-file.js in with it, and the store
 * would latch onto the developer's real ~/.lore/memory.
 */
let store: typeof import("@re-cinq/lore-server-core/features/memory/memory-file.js");
let MemoryOperationSchema: typeof Schema;
let tmpHome: string;
let originalHome: string | undefined;

/** What the schema objects to, or undefined when it accepts the answer.
 *  Responses go through a JSON round-trip first, because that is what a caller
 *  receives: hapi serializes, and a `Date` the driver returned reaches the wire
 *  as a string.
 *
 *  Acceptance is asserted on the ISSUES rather than on parse output: `z.union`
 *  returns the first member that matches and strips the keys that member does
 *  not declare, so the parsed value is a poor witness of what was sent. */
const rejects = (value: unknown) =>
  MemoryOperationSchema.safeParse(JSON.parse(JSON.stringify(value))).error
    ?.issues;

beforeAll(async () => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), "lore-memory-contract-"));
  process.env.HOME = tmpHome;
  store =
    await import("@re-cinq/lore-server-core/features/memory/memory-file.js");
  ({ MemoryOperationSchema } = await import("./memory.js"));
  store.writeMemoryFile("deploy-note", "use --set-string", "agent-contract");
  store.writeMemoryFile("deploy-note", "and never --set", "agent-contract");
});

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("MemoryOperationSchema accepts what the file fallback answers", () => {
  it("write returns the row it landed", () => {
    const written = store.writeMemoryFile("fresh", "value", "agent-contract");

    expect(rejects(written)).toBeUndefined();
    expect(written).toMatchObject({
      key: "fresh",
      version: 1,
      agent_id: "agent-contract",
    });
  });

  it("read returns the latest version", () => {
    const latest = store.readMemoryFile("deploy-note", "agent-contract");

    expect(rejects(latest)).toBeUndefined();
    expect(latest).toMatchObject({
      key: "deploy-note",
      value: "and never --set",
      version: 2,
    });
  });

  it("read of one version returns that version, key included", () => {
    const first = store.readMemoryFile("deploy-note", "agent-contract", 1);

    expect(rejects(first)).toBeUndefined();
    expect(first).toMatchObject({
      key: "deploy-note",
      value: "use --set-string",
      version: 1,
    });
  });

  it("read of a missing key returns null", () => {
    const missing = store.readMemoryFile("no-such-key", "agent-contract");

    expect(rejects(missing)).toBeUndefined();
    expect(missing).toBeNull();
  });

  it("read of every version returns the history newest-first", () => {
    const history = store.readMemoryFile(
      "deploy-note",
      "agent-contract",
      "all",
    );

    expect(rejects(history)).toBeUndefined();
    expect(history).toMatchObject([{ version: 2 }, { version: 1 }]);
  });

  it("search names its source, as the pool path does", () => {
    const hits = store.searchMemoryFile("never --set", "agent-contract");

    expect(rejects(hits)).toBeUndefined();
    expect(hits).toMatchObject([
      { key: "deploy-note", score: 1, source: "memory" },
    ]);
  });

  it("list answers the pool path's projection", () => {
    const page = store.listMemoriesFile("agent-contract", 50, 0);
    const answer = { ...page, limit: 50, offset: 0 };

    expect(rejects(answer)).toBeUndefined();
    expect(answer).toMatchObject({
      total: 2,
      memories: expect.arrayContaining([
        expect.objectContaining({
          key: "deploy-note",
          agent_id: "agent-contract",
          repo: null,
          has_facts: false,
        }),
      ]),
    });
  });

  it("delete acknowledges the key it removed", () => {
    const removed = store.deleteMemoryFile("fresh", "agent-contract");

    expect(rejects(removed)).toBeUndefined();
    expect(removed).toEqual({ key: "fresh", deleted: true });
  });
});
