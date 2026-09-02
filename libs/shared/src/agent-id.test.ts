import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// AGENT_ID_DIR is captured from process.env.HOME at module load, so each test
// points HOME at a fresh tmp dir and re-imports the module.
async function loadResolveAgentId(home: string) {
  process.env.HOME = home;
  vi.resetModules();

  return (await import("./agent-id.js")).resolveAgentId;
}

function restoreEnv(key: string, saved: string | undefined): void {
  if (saved === undefined) {
    delete process.env[key];

    return;
  }
  process.env[key] = saved;
}

describe("resolveAgentId", () => {
  let home: string;
  const savedHome = process.env.HOME;
  const savedEnvId = process.env.LORE_AGENT_ID;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "lore-agent-id-"));
    delete process.env.LORE_AGENT_ID;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    restoreEnv("HOME", savedHome);
    restoreEnv("LORE_AGENT_ID", savedEnvId);
  });

  it("returns the explicit agent id over all other sources", async () => {
    process.env.LORE_AGENT_ID = "env-id";
    mkdirSync(join(home, ".lore"), { recursive: true });
    writeFileSync(join(home, ".lore", "agent-id"), "file-id\n");
    const resolveAgentId = await loadResolveAgentId(home);

    expect(resolveAgentId("explicit-id")).toBe("explicit-id");
  });

  it("returns LORE_AGENT_ID when no explicit id is given", async () => {
    process.env.LORE_AGENT_ID = "pod-name-42";
    mkdirSync(join(home, ".lore"), { recursive: true });
    writeFileSync(join(home, ".lore", "agent-id"), "file-id\n");
    const resolveAgentId = await loadResolveAgentId(home);

    expect(resolveAgentId()).toBe("pod-name-42");
  });

  it("reads ~/.lore/agent-id when no explicit id or env var", async () => {
    mkdirSync(join(home, ".lore"), { recursive: true });
    writeFileSync(join(home, ".lore", "agent-id"), "  machine-stable-id\n");
    const resolveAgentId = await loadResolveAgentId(home);

    expect(resolveAgentId()).toBe("machine-stable-id");
  });

  it("generates a uuid and persists it when no source is set", async () => {
    const resolveAgentId = await loadResolveAgentId(home);
    const id = resolveAgentId();

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(readFileSync(join(home, ".lore", "agent-id"), "utf-8").trim()).toBe(
      id,
    );
    // A second resolution reads the persisted id back rather than regenerating.
    const again = await loadResolveAgentId(home);

    expect(again()).toBe(id);
  });
});
