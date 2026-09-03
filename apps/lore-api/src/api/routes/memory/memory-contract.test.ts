import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restoreEnv } from "../../../integration-tests/restore-env.js";
import type { MemoryOperationSchema as Schema } from "./memory.js";

let store: typeof import("@re-cinq/lore-server-core/features/memory/memory-file.js");
let MemoryOperationSchema: typeof Schema;
let tmpHome: string;
let originalHome: string | undefined;

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
  restoreEnv("HOME", originalHome);
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
