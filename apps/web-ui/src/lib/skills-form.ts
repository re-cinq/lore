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
