// Which skills source a write to the floor stores: kept apart from the adapter so the rule reads on its own.
import { skillsSourceWith } from "../../../domain/agents/skills-source.js";
import type { ConfigWrite } from "./agent-defs-port.js";

/** The source this write stores, or undefined to leave the stored one alone: the adjusting flag rewrites the known source, and a write that adds skills seeds one when none is known. */
export function skillsSourceToStore(
  config: Record<string, unknown>,
  write: ConfigWrite,
): string | undefined {
  const known = config.skills_source ?? write.inheritedConfig?.skills_source;
  const source = known ?? write.skillsSource;
  const { adjustSkillModels: adjust } = write;

  if (typeof source !== "string") {
    return undefined;
  }

  return adjust === undefined
    ? seededSkillsSource(source, { known: Boolean(known), write })
    : skillsSourceWith(source, { adjust });
}

function seededSkillsSource(
  source: string,
  { known, write }: { known: boolean; write: ConfigWrite },
): string | undefined {
  return !known && write.skills?.length ? source : undefined;
}
