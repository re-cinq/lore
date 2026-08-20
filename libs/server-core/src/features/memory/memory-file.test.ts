import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// memory-file.ts captures BASE_DIR = $HOME/.lore/memory at module-load time, so
// HOME must be pointed at a throwaway dir BEFORE the module is imported. Static
// imports are hoisted, so the module is loaded via a dynamic import() inside
// beforeAll after HOME is set, and every call passes an explicit agent id so
// resolveAgentId never reaches for the real ~/.lore.

let mod: typeof import("./memory-file.js");
let tmpHome: string;
let originalHome: string | undefined;

function memoriesFilePath(agentId: string): string {
  return join(tmpHome, ".lore", "memory", agentId, "memories.json");
}

beforeAll(async () => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), "lore-memory-file-"));
  process.env.HOME = tmpHome;
  mod = await import("./memory-file.js");
});

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("memory-file round-trips against real disk", () => {
  it("reads back the written value at version 1", () => {
    mod.writeMemoryFile("deploy-note", "use --set-string", "agent-rw");

    const entry = mod.readMemoryFile("deploy-note", "agent-rw");

    expect(entry).toMatchObject({
      key: "deploy-note",
      value: "use --set-string",
      version: 1,
      is_deleted: false,
    });
  });

  it("bumps to version 2 and keeps history when the key is rewritten", () => {
    mod.writeMemoryFile("gotcha", "first", "agent-ver");
    mod.writeMemoryFile("gotcha", "second", "agent-ver");

    const latest = mod.readMemoryFile("gotcha", "agent-ver");
    const history = mod.readMemoryFile("gotcha", "agent-ver", "all");

    expect(latest).toMatchObject({ value: "second", version: 2 });
    expect(history).toEqual([
      expect.objectContaining({ version: 2, value: "second" }),
      expect.objectContaining({ version: 1, value: "first" }),
    ]);
  });

  it("omits deleted and expired entries from the active list", () => {
    mod.writeMemoryFile("keeper", "active value", "agent-list");
    mod.writeMemoryFile("gone", "deleted value", "agent-list");
    mod.deleteMemoryFile("gone", "agent-list");
    mod.writeMemoryFile("stale", "expired value", "agent-list", 3600);

    const path = memoriesFilePath("agent-list");
    const onDisk: Record<string, { expires_at: string | null }> = JSON.parse(
      readFileSync(path, "utf-8"),
    );

    onDisk["stale"].expires_at = new Date(Date.now() - 1000).toISOString();
    writeFileSync(path, JSON.stringify(onDisk), "utf-8");

    const listing = mod.listMemoriesFile("agent-list");

    expect(listing.total).toBe(1);
    // A listing enumerates keys and carries no value — the pool path's SELECT
    // reads none either, and the endpoint declares one shape for both backends.
    expect(listing.memories).toEqual([
      expect.objectContaining({
        key: "keeper",
        agent_id: "agent-list",
        repo: null,
        has_facts: false,
      }),
    ]);
  });

  it("soft-deletes the record and drops it from reads and the list", () => {
    mod.writeMemoryFile("temp-secret", "shhh", "agent-del");

    const result = mod.deleteMemoryFile("temp-secret", "agent-del");
    const onDisk: Record<string, { is_deleted: boolean }> = JSON.parse(
      readFileSync(memoriesFilePath("agent-del"), "utf-8"),
    );

    expect(result).toEqual({ key: "temp-secret", deleted: true });
    expect(onDisk["temp-secret"].is_deleted).toBe(true);
    expect(mod.readMemoryFile("temp-secret", "agent-del")).toBeNull();
    expect(mod.listMemoriesFile("agent-del").total).toBe(0);
  });

  it("returns degraded substring matches with score 1 on search", () => {
    mod.writeMemoryFile(
      "deploy-tip",
      "run helm with --set-string",
      "agent-src",
    );
    mod.writeMemoryFile("lunch-plan", "tacos on friday", "agent-src");

    const results = mod.searchMemoryFile("helm", "agent-src");

    expect(results).toEqual([
      expect.objectContaining({
        key: "deploy-tip",
        value: "run helm with --set-string",
        score: 1.0,
      }),
    ]);
  });
});
