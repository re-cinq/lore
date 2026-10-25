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
  let running = true;

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

  const res = await fetch(`${apiUrl}/api/skill-definitions`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const skills = (await res.json()) as SkillDefinition[];
  const claudeSkillsDir = path.join(
    process.env.HOME || os.homedir(),
    ".claude",
    "skills",
  );

  await fs.mkdir(claudeSkillsDir, { recursive: true });

  const existingDirs = await fs.readdir(claudeSkillsDir);

  const managedDirs = new Set<string>();

  for (const dir of existingDirs) {
    const dirPath = path.join(claudeSkillsDir, dir);
    const stat = await fs.stat(dirPath).catch(() => null);
    if (!stat || !stat.isDirectory()) continue;

    const markerPath = path.join(dirPath, ".lore-managed");
    const isManaged = await fs
      .stat(markerPath)
      .then(() => true)
      .catch(() => false);
    if (isManaged) {
      managedDirs.add(dir);
    }
  }

  const enabledSkills = skills.filter((s) => s.enabled);
  const enabledNames = new Set(enabledSkills.map((s) => s.name));

  // Remove managed dirs that are no longer enabled
  for (const dir of managedDirs) {
    if (!enabledNames.has(dir)) {
      await fs.rm(path.join(claudeSkillsDir, dir), {
        recursive: true,
        force: true,
      });
    }
  }

  // Write enabled skills
  for (const skill of enabledSkills) {
    const dirPath = path.join(claudeSkillsDir, skill.name);
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(path.join(dirPath, "SKILL.md"), skill.content, "utf8");
    await fs.writeFile(path.join(dirPath, ".lore-managed"), "", "utf8");
  }
}
