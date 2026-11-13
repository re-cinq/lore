const VERBATIM = /\/verbatim\/?$/;

/** Pods fetch skills from `config.skills_source`; a source ending in /verbatim asks the gateway for the skills unchanged, so the flag lives in the URL and cannot drift from it. */
export function adjustsSkillModels(source: string | null | undefined): boolean {
  return !VERBATIM.test(source ?? "");
}

/** The source that makes the gateway adjust each skill's model: the plain URL. */
export function adjustingSkillsSource(source: string): string {
  return source.replace(VERBATIM, "").replace(/\/$/, "");
}

/** The source that makes the gateway serve the skills unchanged. */
export function verbatimSkillsSource(source: string): string {
  return `${adjustingSkillsSource(source)}/verbatim`;
}

export function skillsSourceWith(
  source: string,
  { adjust }: { adjust: boolean },
): string {
  return adjust ? adjustingSkillsSource(source) : verbatimSkillsSource(source);
}
