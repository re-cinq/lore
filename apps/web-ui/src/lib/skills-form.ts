// The skills of an agent definition as the form edits them: a list of skill names (`config.skills`).

/** The skills an agent's resolved config holds. */
export function configuredSkills(config: unknown): string[] {
  return (config as { skills?: string[] } | null)?.skills ?? [];
}

/** The form's `skills` field: absent while the skills are untouched (the save keeps the stored list), an empty list once every skill was removed (a repo then runs with none). */
export function parseSkills(form: FormData): string[] | undefined {
  const field = form.get("skills");

  return typeof field === "string"
    ? (JSON.parse(field) as string[])
    : undefined;
}

/** Whether the agent's pods adjust a skill's model to the agent's: stored in the skills source, as a trailing /verbatim when off. */
export function configuredAdjustSkillModels(config: unknown): boolean {
  const source = (config as { skills_source?: string } | null)?.skills_source;

  // web-ui is not a workspace member, so this mirrors adjustsSkillModels in libs/shared/src/domain/agents/skills-source.ts.
  return !/\/verbatim\/?$/.test(source ?? "");
}

/** The form's `adjust_skill_models` field: absent while the checkbox is untouched (the save keeps the stored source). */
export function parseAdjustSkillModels(form: FormData): boolean | undefined {
  const field = form.get("adjust_skill_models");

  return field === null ? undefined : field === "1";
}
