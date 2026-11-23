import type { SkillFile } from "@re-cinq/lore-shared/agent-defaults/skill-file.js";
import type { PackOverlay, ShippedCatalog } from "./pack-loader.js";

export interface SkillPorts {
  /** The org catalogue's row of the skill, or null. */
  orgSkill(name: string): Promise<SkillFile | null>;
  /** Writes the org catalogue row, keeping its enabled flag. */
  putSkill(skill: SkillFile): Promise<void>;
  removeSkill(name: string): Promise<void>;
}

/** The pack's skills as `skill/<name>`; a skill the pack no longer sets goes back to Lore's own as `shipped-skill/<name>`, or is deleted as `removed-skill/<name>` when only the pack had it. */
export async function putSkills(
  ports: SkillPorts,
  overlay: PackOverlay,
  dropped: string[],
  shipped: ShippedCatalog,
): Promise<string[]> {
  const packed = [...overlay.skills.values()].map(({ skill }) => skill);
  const restored = dropped.flatMap((name) => shipped.skills.get(name) ?? []);
  const removed = dropped.filter((name) => !shipped.skills.has(name));

  return [
    ...(await putChanged(ports, packed, "skill")),
    ...(await putChanged(ports, restored, "shipped-skill")),
    ...(await removeHeld(ports, removed)),
  ];
}

async function putChanged(
  ports: SkillPorts,
  skills: SkillFile[],
  prefix: string,
): Promise<string[]> {
  const held = await Promise.all(
    skills.map((skill) => ports.orgSkill(skill.name)),
  );
  const differing = skills.filter((skill, index) => {
    const row = held[index];

    return !row || !sameSkill(row, skill);
  });

  await Promise.all(differing.map((skill) => ports.putSkill(skill)));

  return differing.map((skill) => `${prefix}/${skill.name}`);
}

async function removeHeld(
  ports: SkillPorts,
  names: string[],
): Promise<string[]> {
  const held = await Promise.all(names.map((name) => ports.orgSkill(name)));
  const present = names.filter((_, index) => held[index]);

  await Promise.all(present.map((name) => ports.removeSkill(name)));

  return present.map((name) => `removed-skill/${name}`);
}

function sameSkill(held: SkillFile, wanted: SkillFile): boolean {
  return (
    held.title === wanted.title &&
    held.description === wanted.description &&
    held.model === wanted.model &&
    held.content === wanted.content
  );
}
