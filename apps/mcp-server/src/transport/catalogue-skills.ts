import { z } from "zod";
import {
  SkillDefinitionSchema,
  type SkillDefinition,
} from "@re-cinq/lore-shared/models/skill-definition.js";
import { proxyGetApi } from "@re-cinq/lore-server-core/proxy.js";

const SkillsListBody = z.object({ skills: z.array(SkillDefinitionSchema) });

/** The org's skill catalogue as lore-api serves it, or null when the API cannot be reached or refuses. */
export async function readCatalogue(): Promise<SkillDefinition[] | null> {
  const res = await proxyGetApi("/api/skill-definitions");

  return res.ok ? SkillsListBody.parse(JSON.parse(res.body)).skills : null;
}

/** The enabled catalogue skill of that name; a disabled one is not served. */
export function enabledSkillNamed(
  skills: SkillDefinition[],
  name: string,
): SkillDefinition | undefined {
  return skills.find((skill) => skill.enabled && skill.name === name);
}
