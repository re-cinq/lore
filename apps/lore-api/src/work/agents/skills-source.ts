import type { ConfigWrite } from "@re-cinq/lore-shared/project/agents/agent-defs-port.js";

export const skillsSourceDefault = (): string | undefined =>
  process.env.LORE_SKILLS_URL || undefined;

export const skillsSourceWrite = (): Pick<ConfigWrite, "skillsSource"> => {
  const skillsSource = skillsSourceDefault();

  return skillsSource ? { skillsSource } : {};
};
