// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import SkillFields from "./SkillFields";

const ADJUST_LABEL = "Adjust skill models to this agent's model";

const CATALOGUE = [
  { name: "cli-design", title: "CLI design" },
  { name: "tdd-loop", title: "TDD loop" },
];

function submitted(container: HTMLElement): string[] | undefined {
  const field = container.querySelector<HTMLInputElement>(
    'input[name="skills"]',
  );

  return field ? JSON.parse(field.value) : undefined;
}

describe("SkillFields", () => {
  it("lists cli-design by its title and lore-context with the note built into the gateway", () => {
    const { getByText, getAllByText } = render(
      <SkillFields
        adjustModels
        skills={["cli-design", "lore-context"]}
        catalogue={{ options: CATALOGUE }}
      />,
    );

    expect({
      title: getByText("CLI design") !== null,
      baked: getByText("lore-context") !== null,
      notes: getAllByText("built into the gateway").length,
    }).toEqual({ title: true, baked: true, notes: 1 });
  });

  it("submits no skills field while the skills are untouched", () => {
    const { container } = render(
      <SkillFields
        adjustModels
        skills={["cli-design"]}
        catalogue={{ options: CATALOGUE }}
      />,
    );

    expect(submitted(container)).toBeUndefined();
  });

  it("submits cli-design and tdd-loop after tdd-loop is chosen in the Add skill select", () => {
    const { container, getByLabelText } = render(
      <SkillFields
        adjustModels
        skills={["cli-design"]}
        catalogue={{ options: CATALOGUE }}
      />,
    );

    fireEvent.change(getByLabelText("Add skill"), {
      target: { value: "tdd-loop" },
    });

    expect(submitted(container)).toEqual(["cli-design", "tdd-loop"]);
  });

  it("offers only the catalogue skills not yet chosen", () => {
    const { getByLabelText } = render(
      <SkillFields
        adjustModels
        skills={["cli-design"]}
        catalogue={{ options: CATALOGUE }}
      />,
    );
    const options = Array.from(
      (getByLabelText("Add skill") as HTMLSelectElement).options,
    ).map((option) => option.value);

    expect(options).toEqual(["", "tdd-loop"]);
  });

  it("submits an empty list after the only skill is removed", () => {
    const { container, getByLabelText } = render(
      <SkillFields
        adjustModels
        skills={["cli-design"]}
        catalogue={{ options: CATALOGUE }}
      />,
    );

    fireEvent.click(getByLabelText("Remove skill cli-design"));

    expect(submitted(container)).toEqual([]);
  });

  it("shows the load failure message and still lists the stored skills", () => {
    const { getByText } = render(
      <SkillFields
        adjustModels
        skills={["cli-design"]}
        catalogue={{ options: [], error: "lore-api unreachable" }}
      />,
    );

    expect([
      getByText(/lore-api unreachable/) !== null,
      getByText("cli-design") !== null,
    ]).toEqual([true, true]);
  });

  it("checks the adjust box for a plain skills source and unchecks it for the /verbatim one", () => {
    const plain = render(
      <SkillFields skills={[]} adjustModels catalogue={{ options: [] }} />,
    );
    const verbatim = render(
      <SkillFields
        skills={[]}
        adjustModels={false}
        catalogue={{ options: [] }}
      />,
    );

    expect([
      within(plain.container).getByLabelText(ADJUST_LABEL),
      within(verbatim.container).getByLabelText(ADJUST_LABEL),
    ]).toMatchObject([{ checked: true }, { checked: false }]);
  });

  it("submits adjust_skill_models 0 once the checked box is unchecked and nothing before", () => {
    const { container, getByLabelText } = render(
      <SkillFields skills={[]} adjustModels catalogue={{ options: [] }} />,
    );
    const field = () =>
      container.querySelector<HTMLInputElement>(
        'input[name="adjust_skill_models"]',
      )?.value;
    const untouched = field();

    fireEvent.click(getByLabelText(ADJUST_LABEL));

    expect({ untouched, unchecked: field() }).toEqual({
      untouched: undefined,
      unchecked: "0",
    });
  });
});
