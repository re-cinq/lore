// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NewPlanView from "./NewPlanView";

describe("NewPlanView", () => {
  it("offers every plan template, starting from feature", () => {
    render(<NewPlanView action={async () => ({})} />);
    const template = screen.getByRole("combobox", { name: "Template" });

    expect({
      value: (template as HTMLSelectElement).value,
      options: [...(template as HTMLSelectElement).options].map(
        (option) => option.value,
      ),
    }).toEqual({
      value: "feature",
      options: [
        "feature",
        "ui-change",
        "performance",
        "refactor",
        "incident-response",
      ],
    });
  });

  it("asks for an optional user story URL", () => {
    render(<NewPlanView action={async () => ({})} />);
    const story = screen.getByRole("textbox", { name: "User story" });

    expect({
      type: story.getAttribute("type"),
      required: (story as HTMLInputElement).required,
    }).toEqual({ type: "url", required: false });
  });
});
