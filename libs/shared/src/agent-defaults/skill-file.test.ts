import { describe, expect, it } from "vitest";
import { parseSkillFile } from "./skill-file.js";

const SAMPLE = `---
name: sample-skill
description: >-
  Does a sample thing.
model: sonnet
---

# Sample Skill

Body text.
`;

describe("parseSkillFile", () => {
  it("returns name, title, description, model and the whole file as content when frontmatter and heading present", () => {
    expect(parseSkillFile("sample-skill", SAMPLE)).toEqual({
      name: "sample-skill",
      title: "Sample Skill",
      description: "Does a sample thing.",
      model: "sonnet",
      content: SAMPLE,
    });
  });

  it("returns the name as title, empty description and null model when the text has no frontmatter or heading", () => {
    expect(parseSkillFile("bare", "just text\n")).toEqual({
      name: "bare",
      title: "bare",
      description: "",
      model: null,
      content: "just text\n",
    });
  });
});
