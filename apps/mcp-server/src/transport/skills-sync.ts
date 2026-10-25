import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runPollLoop } from "@re-cinq/lore-shared/lib/backoff.js";

interface SkillDefinition {
  name: string;
  content: string;
  enabled: boolean;
}

export function startSkillsSync(): void {
  const intervalMs = parseInt(
    process.env.LORE_SKILLS_SYNC_INTERVAL_MS || "300000",
    10,
  );
  const running = true;

  // We don't await runPollLoop because it runs continuously
  void runPollLoop({
    running: () => running,
    tick: async () => {
      try {
        await syncSkills();
      } catch (err) {
        console.error("[lore-mcp] skills sync loop failed:", err);
      }
    },
    delayFor: () => intervalMs,
  });
}

async function syncSkills(): Promise<void> {
  const apiUrl = process.env.LORE_API_URL;
  const token = process.env.LORE_INGEST_TOKEN;

  if (!apiUrl || !token) {
    return;
  }

  const skills = await fetchSkills(apiUrl, token);
  const dir = path.join(process.env.HOME || os.homedir(), ".claude", "skills");

  await fs.mkdir(dir, { recursive: true });

  const enabled = skills.filter((s) => s.enabled);
  const enabledNames = new Set(enabled.map((s) => s.name));

  await cleanupStaleSkills(dir, await getManagedDirs(dir), enabledNames);
  await writeEnabledSkills(dir, enabled);
}

async function fetchSkills(
  apiUrl: string,
  token: string,
): Promise<SkillDefinition[]> {
  const res = await fetch(`${apiUrl}/api/skill-definitions`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return (await res.json()) as SkillDefinition[];
}

async function getManagedDirs(claudeSkillsDir: string): Promise<Set<string>> {
  const existingDirs = await fs.readdir(claudeSkillsDir);
  const managedDirs = new Set<string>();

  for (const dir of existingDirs) {
    if (await isManagedDir(path.join(claudeSkillsDir, dir))) {
      managedDirs.add(dir);
    }
  }

  return managedDirs;
}

async function isManagedDir(dirPath: string): Promise<boolean> {
  const stat = await fs.stat(dirPath).catch(() => null);

  if (!stat?.isDirectory()) {
    return false;
  }

  const markerPath = path.join(dirPath, ".lore-managed");

  return fs
    .stat(markerPath)
    .then(() => true)
    .catch(() => false);
}

async function cleanupStaleSkills(
  claudeSkillsDir: string,
  managedDirs: Set<string>,
  enabledNames: Set<string>,
): Promise<void> {
  for (const dir of managedDirs) {
    if (!enabledNames.has(dir)) {
      await fs.rm(path.join(claudeSkillsDir, dir), {
        recursive: true,
        force: true,
      });
    }
  }
}

async function writeEnabledSkills(
  claudeSkillsDir: string,
  enabledSkills: SkillDefinition[],
): Promise<void> {
  for (const skill of enabledSkills) {
    const dirPath = path.join(claudeSkillsDir, skill.name);

    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(path.join(dirPath, "SKILL.md"), skill.content, "utf8");
    await fs.writeFile(path.join(dirPath, ".lore-managed"), "", "utf8");
  }
}
