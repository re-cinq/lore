import { describe, it, expect } from "vitest";
import { configuredSkills, parseSkills } from "./skills-form";

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
