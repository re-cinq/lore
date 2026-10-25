import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildMcpServer } from "./build-mcp-server.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("Skills Sync Background Loop", () => {
  const originalFetch = global.fetch;
  let tempHome: string;
  let claudeSkillsDir: string;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "skills-sync-test-"));
    claudeSkillsDir = path.join(tempHome, ".claude", "skills");
    await fs.mkdir(claudeSkillsDir, { recursive: true });

    process.env.HOME = tempHome;
    process.env.LORE_API_URL = "http://fake-api";
    process.env.LORE_INGEST_TOKEN = "fake-token";

    global.fetch = vi.fn(async (url) => {
      if (url === "http://fake-api/api/skill-definitions") {
        return {
          ok: true,
          json: async () => [
            { name: "test-skill", content: "test content", enabled: true },
            { name: "disabled-skill", content: "disabled", enabled: false },
          ],
        } as Response;
      }

      return { ok: true, json: async () => ({}) } as Response;
    });
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it("syncs enabled skills locally with a marker on boot, ignoring unmanaged directories.", async () => {
    const manualSkillDir = path.join(claudeSkillsDir, "manual-skill");

    await fs.mkdir(manualSkillDir);
    await fs.writeFile(path.join(manualSkillDir, "SKILL.md"), "manual content");

    buildMcpServer({ serverMode: "full" });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const testSkillDir = path.join(claudeSkillsDir, "test-skill");
    const dirs = await fs.readdir(claudeSkillsDir);

    const actualState = {
      dirs: dirs.sort(),
      testSkillContent: await fs
        .readFile(path.join(testSkillDir, "SKILL.md"), "utf8")
        .catch(() => null),
      testSkillMarkerExists: !!(await fs
        .stat(path.join(testSkillDir, ".lore-managed"))
        .catch(() => null)),
      manualSkillContent: await fs
        .readFile(path.join(manualSkillDir, "SKILL.md"), "utf8")
        .catch(() => null),
      manualSkillMarkerExists: !!(await fs
        .stat(path.join(manualSkillDir, ".lore-managed"))
        .catch(() => null)),
    };

    expect(actualState).toEqual({
      dirs: ["manual-skill", "test-skill"],
      testSkillContent: "test content",
      testSkillMarkerExists: true,
      manualSkillContent: "manual content",
      manualSkillMarkerExists: false,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://fake-api/api/skill-definitions",
      expect.anything(),
    );
  });
});
