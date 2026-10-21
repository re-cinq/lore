import { describe, it, expect } from "vitest";
import { fromRow } from "../../lib/row.js";

describe("SkillDefinition model", () => {
  it("validates and deserializes skill definition rows. ([validated by name](libs/shared/src/domain/models/skill-definition.acceptance.test.ts#L5))", async () => {
    const { SkillDefinitionSchema, SKILL_DEFINITION_COLUMNS } =
      await import("./skill-definition.js");

    const dbRow = {
      name: "test-skill",
      title: "Test Skill",
      description: "A test skill.",
      model: "claude-3-5-sonnet-20241022",
      content: "## Help\n\nSome help",
      enabled: true,
      project_id: null,
    };

    const parsed = fromRow(SKILL_DEFINITION_COLUMNS, dbRow);
    expect(parsed.name).toBe("test-skill");

    const validated = SkillDefinitionSchema.parse(parsed);
    expect(validated.name).toBe("test-skill");
  });
});
