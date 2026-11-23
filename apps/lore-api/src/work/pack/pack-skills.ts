import { parseSkillFile } from "@re-cinq/lore-shared/agent-defaults/skill-file.js";
import type { SkillFile } from "@re-cinq/lore-shared/agent-defaults/skill-file.js";
import { hasValidHelpBlock } from "@re-cinq/lore-shared/agent-defaults/skill-help-block.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { SKILL_NAME } from "@re-cinq/lore-shared/models/skill-definition.js";
import type { PackFile } from "./fetch-pack.js";
import { skillFileOf } from "./pack-paths.js";
import { attempt, type Refusal } from "./pack-refusal.js";

export type SkillSource = "pack-new" | "replaced";

export interface OverlaySkill {
  skill: SkillFile;
  source: SkillSource;
}

interface SkillsInput {
  files: readonly PackFile[];
  shipped: { skills: ReadonlyMap<string, SkillFile> };
}

/** The catalogue skills the pack sets, each a replacement of a shipped skill or a new one. */
export function skillsOverlay({ files, shipped }: SkillsInput) {
  const skills = new Map<string, OverlaySkill>();
  const refused: Refusal[] = [];

  for (const file of files) {
    const name = skillFileOf(file.path);

    if (name === undefined) {
      continue;
    }
    const result = attempt(file.path, () => skillOf(name, file.text, shipped));

    if ("refusal" in result) {
      refused.push(result.refusal);
      continue;
    }
    skills.set(name, result.made);
  }

  return { skills, refused };
}

function skillOf(
  name: string,
  text: string,
  shipped: SkillsInput["shipped"],
): OverlaySkill {
  enforceTrue(
    SKILL_NAME.test(name),
    Error,
    `${name} is not a skill name: use lower-case letters, digits and hyphens`,
  );
  enforceTrue(
    hasValidHelpBlock(text),
    Error,
    `${name} must carry a lore-help block with a Summary and a Usage line`,
  );

  return {
    skill: parseSkillFile(name, text),
    source: shipped.skills.has(name) ? "replaced" : "pack-new",
  };
}
