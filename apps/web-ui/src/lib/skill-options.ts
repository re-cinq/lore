import type { LoadedSkills } from "./fetch-skills";
import type { SkillDefinition } from "./skill-definition";

export interface SkillOption {
  name: string;
  title: string;
}

/** What the agent form's skills select is given: the enabled catalogue skills, or the reason there are none. */
export interface SkillCatalogue {
  options: SkillOption[];
  error?: string;
}

const isEnabled = (skill: SkillDefinition): boolean => skill.enabled;

const optionOf = ({ name, title }: SkillDefinition): SkillOption => ({
  name,
  title,
});

const optionsOf = (skills: SkillDefinition[]): SkillOption[] =>
  skills.filter(isEnabled).map(optionOf);

export function skillCatalogueOf(loaded: LoadedSkills): SkillCatalogue {
  return loaded.status === "ok"
    ? { options: optionsOf(loaded.skills) }
    : { options: [], error: loaded.message };
}
