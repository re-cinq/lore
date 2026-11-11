import { describe, it, expect } from "vitest";
import {
  configuredAdjustSkillModels,
  configuredSkills,
  parseAdjustSkillModels,
  parseSkills,
} from "./skills-form";

function fd(entries: Record<string, string>): FormData {
  const form = new FormData();

  for (const [key, value] of Object.entries(entries)) {
    form.set(key, value);
  }

  return form;
}

describe("parseSkills", () => {
  it("reads the list from the skills field and answers undefined when the field is absent", () => {
    expect([
      parseSkills(
        fd({ skills: JSON.stringify(["cli-design", "lore-context"]) }),
      ),
      parseSkills(fd({})),
    ]).toEqual([["cli-design", "lore-context"], undefined]);
  });
});

describe("configuredSkills", () => {
  it("lists lore-context from the config and nothing for a null config or one without skills", () => {
    expect([
      configuredSkills({ skills: ["lore-context"] }),
      configuredSkills(null),
      configuredSkills({ test_policy: "none" }),
    ]).toEqual([["lore-context"], [], []]);
  });
});

describe("parseAdjustSkillModels", () => {
  it("reads 1 as true, 0 as false and an absent field as undefined", () => {
    expect([
      parseAdjustSkillModels(fd({ adjust_skill_models: "1" })),
      parseAdjustSkillModels(fd({ adjust_skill_models: "0" })),
      parseAdjustSkillModels(fd({})),
    ]).toEqual([true, false, undefined]);
  });
});

describe("configuredAdjustSkillModels", () => {
  it("is off only for the skills_source https://gw/skills/verbatim", () => {
    expect([
      configuredAdjustSkillModels({ skills_source: "https://gw/skills" }),
      configuredAdjustSkillModels({
        skills_source: "https://gw/skills/verbatim",
      }),
      configuredAdjustSkillModels(null),
    ]).toEqual([true, false, true]);
  });
});
