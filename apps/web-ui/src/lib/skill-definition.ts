import type { components } from "@/lib/api/schema";

export type SkillDefinition =
  components["schemas"]["SkillDefinitionsList"]["skills"][number];
