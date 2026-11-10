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
    expect(container.querySelector("textarea")).toBeNull();
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
});
