// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { SkillForm } from "./SkillForm";
import { HELP_BLOCK_TEMPLATE } from "./help-template";
import type { SkillFormState } from "./actions";

afterEach(cleanup);

const REFUSAL =
  "content: must carry a lore-help block with a Summary and a Usage line";

const refusing = async (): Promise<SkillFormState> => ({
  error: REFUSAL,
  values: {
    name: "my-skill",
    title: "My skill",
    description: "",
    model: "",
    content: "typed without a help block",
    enabled: true,
  },
});

function submittedContent(): FormDataEntryValue | null {
  return new FormData(document.querySelector("form")!).get("content");
}

describe("SkillForm", () => {
  it("shows the API's lore-help refusal and the typed content after a refused save", async () => {
    render(<SkillForm skill={null} action={refusing} />);

    fireEvent.submit(
      screen.getByRole("button", { name: "Create" }).closest("form")!,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(REFUSAL);
    expect(submittedContent()).toBe("typed without a help block");
  });

  it("starts a new skill's content with the lore-help template", () => {
    render(<SkillForm skill={null} action={refusing} />);

    expect(submittedContent()).toBe(HELP_BLOCK_TEMPLATE);
  });

  it("starts an existing skill's content with its stored content", () => {
    const skill = {
      name: "tdd",
      title: "TDD",
      description: "",
      model: null,
      content: "stored",
      enabled: true,
      projectId: null,
    };

    render(<SkillForm skill={skill} action={refusing} />);

    expect(submittedContent()).toBe("stored");
  });

  it("edits the content in the prompt editor instead of a textarea", () => {
    const { container } = render(<SkillForm skill={null} action={refusing} />);

    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(container.querySelector("textarea[name=content]")).toBeNull();
  });

  it("offers Enabled as a Yes/No select that starts on Yes for a new skill", () => {
    render(<SkillForm skill={null} action={refusing} />);
    const select = screen.getByLabelText("Enabled") as HTMLSelectElement;

    expect({
      tag: select.tagName,
      options: [...select.options].map((option) => option.text),
      value: select.value,
    }).toEqual({ tag: "SELECT", options: ["Yes", "No"], value: "yes" });
  });

  it("starts the Enabled select on No for a stored disabled skill", () => {
    const skill = {
      name: "tdd",
      title: "TDD",
      description: "",
      model: null,
      content: "stored",
      enabled: false,
      projectId: null,
    };

    render(<SkillForm skill={skill} action={refusing} />);

    expect(screen.getByLabelText("Enabled")).toHaveValue("no");
  });

  it("explains under Enabled that Yes installs the skill into ~/.claude/skills", () => {
    render(<SkillForm skill={null} action={refusing} />);

    expect(
      screen.getByText(
        "Yes installs this skill into every developer's ~/.claude/skills through the Lore MCP server; No removes it there.",
      ),
    ).toBeTruthy();
  });

  it("edits the description in a 3-row textarea named description", () => {
    render(<SkillForm skill={null} action={refusing} />);
    const field = screen.getByLabelText("Description") as HTMLTextAreaElement;

    expect({ tag: field.tagName, name: field.name, rows: field.rows }).toEqual({
      tag: "TEXTAREA",
      name: "description",
      rows: 3,
    });
  });

  it("starts the description textarea on the stored multi-line description", () => {
    const skill = {
      name: "tdd",
      title: "TDD",
      description: "first line\nsecond line",
      model: null,
      content: "stored",
      enabled: true,
      projectId: null,
    };

    render(<SkillForm skill={skill} action={refusing} />);

    expect(screen.getByLabelText("Description")).toHaveValue(
      "first line\nsecond line",
    );
  });

  it("edits only the body of a stored skill and keeps its extra frontmatter in a hidden field", () => {
    const skill = {
      name: "tdd",
      title: "TDD",
      description: "Drives tests",
      model: null,
      content:
        "---\nname: tdd\ndescription: Drives tests\ncontext: fork\n---\n\n# TDD\n\nRed, green.\n",
      enabled: true,
      projectId: null,
    };

    render(<SkillForm skill={skill} action={refusing} />);
    const form = new FormData(document.querySelector("form")!);

    expect({
      content: form.get("content"),
      extraFrontmatter: form.get("extra_frontmatter"),
    }).toEqual({ content: "Red, green.\n", extraFrontmatter: "context: fork" });
  });

  it("explains under the editor that name, title, description and model come from the fields", () => {
    render(<SkillForm skill={null} action={refusing} />);

    expect(
      screen.getByText(
        "Name, title, description and model are written into the file from the fields above.",
      ),
    ).toBeTruthy();
  });
});
