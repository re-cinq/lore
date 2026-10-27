import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { runPollLoop } from "@re-cinq/lore-shared/lib/backoff.js";
import {
  SkillDefinitionSchema,
  type SkillDefinition,
} from "@re-cinq/lore-shared/models/skill-definition.js";
import { proxyGetApi } from "@re-cinq/lore-server-core/proxy.js";

// Installs the org's skills into ~/.claude/skills (specs/org-skills FR-004); it only ever touches a directory carrying its marker.

const MARKER = ".lore-managed";
const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_INTERVAL_MS = 5 * 60_000;

const SkillsListBody = z.object({ skills: z.array(SkillDefinitionSchema) });

/** A directory already under ~/.claude/skills, and whether this loop wrote it. */
export interface LocalSkillDir {
  name: string;
  managed: boolean;
}

export interface SkillSyncPlan {
  write: SkillDefinition[];
  remove: string[];
}

export function startSkillsSync(): void {
  const intervalMs =
    Number(process.env.LORE_SKILLS_SYNC_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

  void runPollLoop({
    tick: () => syncSkillsLogged(skillsDir()),
    delayFor: () => intervalMs,
    sleep: unrefSleep,
  });
}

/** Enabled skills go in unless a hand-installed directory holds the name; a managed directory whose skill is gone or disabled comes out. */
export function planSkillSync(
  remote: SkillDefinition[],
  local: LocalSkillDir[],
): SkillSyncPlan {
  const wanted = remote.filter(
    (skill) => skill.enabled && SAFE_NAME.test(skill.name),
  );
  const wantedNames = new Set(wanted.map((skill) => skill.name));
  const handInstalled = new Set(
    local.filter((dir) => !dir.managed).map((dir) => dir.name),
  );

  return {
    write: wanted.filter((skill) => !handInstalled.has(skill.name)),
    remove: local
      .filter((dir) => dir.managed && !wantedNames.has(dir.name))
      .map((dir) => dir.name),
  };
}

export async function applySkillSync(
  dir: string,
  plan: SkillSyncPlan,
): Promise<void> {
  await Promise.all([
    ...plan.remove.map((name) =>
      fs.rm(path.join(dir, name), { recursive: true, force: true }),
    ),
    ...plan.write.map((skill) => writeSkill(dir, skill)),
  ]);
}

export async function readLocalSkillDirs(
  dir: string,
): Promise<LocalSkillDir[]> {
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });

  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => ({
        name: entry.name,
        managed: await exists(path.join(dir, entry.name, MARKER)),
      })),
  );
}

async function syncSkillsLogged(dir: string): Promise<void> {
  await syncSkills(dir).catch((err: unknown) =>
    console.error("[lore] skills sync failed:", err),
  );
}

async function syncSkills(dir: string): Promise<void> {
  const res = await proxyGetApi("/api/skill-definitions");

  if (!res.ok) {
    return;
  }
  const { skills } = SkillsListBody.parse(JSON.parse(res.body));

  await applySkillSync(
    dir,
    planSkillSync(skills, await readLocalSkillDirs(dir)),
  );
}

async function writeSkill(dir: string, skill: SkillDefinition): Promise<void> {
  const skillDir = path.join(dir, skill.name);

  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, MARKER), "");
  await fs.writeFile(path.join(skillDir, "SKILL.md"), skill.content);
}

function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

function skillsDir(): string {
  return path.join(os.homedir(), ".claude", "skills");
}

/** The loop must not keep the stdio adapter alive once Claude Code closes it. */
function unrefSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}
