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

describe("SkillForm", () => {
  it("shows the API's lore-help refusal and the typed content after a refused save", async () => {
    render(<SkillForm skill={null} action={refusing} />);

    fireEvent.submit(
      screen.getByRole("button", { name: "Create" }).closest("form")!,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(REFUSAL);
    expect(screen.getByLabelText(/content/i)).toHaveValue(
      "typed without a help block",
    );
  });

  it("starts a new skill's content with the lore-help template", () => {
    render(<SkillForm skill={null} action={refusing} />);

    expect(screen.getByLabelText(/content/i)).toHaveValue(HELP_BLOCK_TEMPLATE);
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

    expect(screen.getByLabelText(/content/i)).toHaveValue("stored");
  });
});
