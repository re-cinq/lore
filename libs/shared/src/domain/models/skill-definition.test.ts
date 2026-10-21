import { describe, it, expect } from "vitest";
import {
  SKILL_DEFINITION_COLUMNS,
  SkillDefinitionSchema,
} from "./skill-definition.js";

// specs/org-skills/spec.md — Constraints: skill payload maps directly to DB storage
describe("SkillDefinitionSchema", () => {
  it("SKILL_DEFINITION_COLUMNS maps projectId to the project_id column", () => {
    expect(SKILL_DEFINITION_COLUMNS.projectId).toBe("project_id");
  });

  it("accepts null for optional model and projectId fields", () => {
    const result = SkillDefinitionSchema.safeParse({
      name: "my-skill",
      title: "My Skill",
      description: "Does something.",
      model: null,
      content: "content",
      enabled: true,
      projectId: null,
    });
    expect(result.success).toBe(true);
  });
});
