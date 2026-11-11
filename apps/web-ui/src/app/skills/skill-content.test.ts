// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import { composeSkillContent, splitSkillContent } from "./skill-content";

const shippedSkill = (name: string) =>
  readFileSync(
    new URL(
      `../../../../../libs/shared/src/agent-defaults/skills/${name}.md`,
      import.meta.url,
    ),
    "utf8",
  );

describe("splitSkillContent", () => {
  it("keeps argument-hint and context and drops name, description, model and the title heading for check-tests", () => {
    const { extraFrontmatter, body } = splitSkillContent(
      shippedSkill("check-tests"),
    );

    expect({
      extraFrontmatter,
      bodyStart: body.split("\n")[0],
    }).toEqual({
      extraFrontmatter: 'argument-hint: "[base-branch]"\ncontext: fork',
      bodyStart: "Run tests only for files that changed in the current branch.",
    });
  });

  it("keeps the folded description out of the extra keys and keeps both extra keys for tdd-loop", () => {
    const { extraFrontmatter } = splitSkillContent(shippedSkill("tdd-loop"));

    expect(extraFrontmatter).toBe(
      'argument-hint: "[--gate-tests] [session goal]"\ndisable-model-invocation: true',
    );
  });

  it("keeps the whole body of test-design-reviewer, which has no leading heading", () => {
    const content = shippedSkill("test-design-reviewer");
    const { body } = splitSkillContent(content);

    expect(content.endsWith(body)).toBe(true);
    expect(body.startsWith("Review tests as executable specifications")).toBe(
      true,
    );
  });

  it("returns content without frontmatter and heading unchanged as the body", () => {
    expect(splitSkillContent("## Help\ntext\n")).toEqual({
      extraFrontmatter: "",
      body: "## Help\ntext\n",
    });
  });
});

describe("composeSkillContent", () => {
  const fields = { name: "ghost", title: "Ghost", model: "" };

  it("writes frontmatter with the description, then the title heading and the body", () => {
    expect(
      composeSkillContent({
        ...fields,
        description: "Haunts",
        extraFrontmatter: "context: fork",
        body: "text\n",
      }),
    ).toBe(
      "---\nname: ghost\ndescription: Haunts\ncontext: fork\n---\n\n# Ghost\n\ntext\n",
    );
  });

  it("writes the model only when set", () => {
    expect(
      composeSkillContent({
        ...fields,
        model: "claude-haiku-4-5-20251001",
        description: "Haunts",
        extraFrontmatter: "",
        body: "text\n",
      }),
    ).toContain("model: claude-haiku-4-5-20251001\n---");
  });

  it("quotes a description that holds a colon and a line break", () => {
    expect(
      composeSkillContent({
        ...fields,
        description: "a: b\nc",
        extraFrontmatter: "",
        body: "",
      }),
    ).toContain('description: "a: b\\nc"\n');
  });

  it("carries the changed description and every extra key through a split of tdd-loop", () => {
    const { extraFrontmatter, body } = splitSkillContent(
      shippedSkill("tdd-loop"),
    );
    const composed = composeSkillContent({
      name: "tdd-loop",
      title: "TDD Loop",
      model: "",
      description: "A new description",
      extraFrontmatter,
      body,
    });

    expect({
      frontmatter: composed.split("\n---\n")[0],
      roundTrip: splitSkillContent(composed),
    }).toEqual({
      frontmatter: `---\nname: tdd-loop\ndescription: A new description\n${extraFrontmatter}`,
      roundTrip: { extraFrontmatter, body },
    });
  });
});
