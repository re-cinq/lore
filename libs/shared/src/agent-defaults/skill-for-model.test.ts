import { describe, it, expect } from "vitest";
import { skillContentForModel } from "./skill-for-model.js";

const skillWithModel = (model: string) =>
  `---\nname: cli-design\ndescription: d\nmodel: ${model}\ncontext: fork\nagent: Explore\n---\n\n# cli-design\n\nbody\n`;

const withoutModelLine = `---\nname: cli-design\ndescription: d\ncontext: fork\nagent: Explore\n---\n\n# cli-design\n\nbody\n`;

describe("skillContentForModel", () => {
  it("removes the model line when a claude-sonnet-4-6 skill is served to gemini-4-argon", () => {
    expect(
      skillContentForModel(
        skillWithModel("claude-sonnet-4-6"),
        "gemini-4-argon",
      ),
    ).toEqual(withoutModelLine);
  });

  it("removes the model line when a claude-sonnet-4-6 skill is served to gpt-5-codex", () => {
    expect(
      skillContentForModel(skillWithModel("claude-sonnet-4-6"), "gpt-5-codex"),
    ).toEqual(withoutModelLine);
  });

  it("keeps the model line when a claude-sonnet-4-6 skill is served to claude-opus-4-8", () => {
    const content = skillWithModel("claude-sonnet-4-6");

    expect(skillContentForModel(content, "claude-opus-4-8")).toEqual(content);
  });

  it("keeps a skill without a model line unchanged for gemini-4-argon", () => {
    expect(skillContentForModel(withoutModelLine, "gemini-4-argon")).toEqual(
      withoutModelLine,
    );
  });

  it("keeps a model: line in the body after the frontmatter", () => {
    const content = `---\nname: x\nmodel: claude-sonnet-4-6\n---\n\nmodel: x\n`;

    expect(skillContentForModel(content, "gemini-4-argon")).toEqual(
      `---\nname: x\n---\n\nmodel: x\n`,
    );
  });
});
