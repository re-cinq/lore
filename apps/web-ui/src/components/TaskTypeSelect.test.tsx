// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskTypeSelect } from "./TaskTypeSelect";

const OPTIONS = [
  { value: "general", label: "General" },
  { value: "runbook", label: "Runbook" },
];

describe("TaskTypeSelect", () => {
  it("describes the first option by default", () => {
    render(<TaskTypeSelect options={OPTIONS} />);
    expect(
      screen.getByText("Open-ended task with full Lore context."),
    ).toBeInTheDocument();
  });

  it("updates the description when the selection changes", () => {
    render(<TaskTypeSelect options={OPTIONS} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "runbook" },
    });
    expect(
      screen.getByText("Generates an incident runbook."),
    ).toBeInTheDocument();
  });

  it("keeps the task_type field name for form submission", () => {
    render(<TaskTypeSelect options={OPTIONS} />);
    expect(screen.getByRole("combobox")).toHaveAttribute("name", "task_type");
  });
});
