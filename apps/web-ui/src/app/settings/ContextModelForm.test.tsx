// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ContextModelForm from "./ContextModelForm";

describe("ContextModelForm", () => {
  it("shows the saved vertex provider and gemini-3-flash-preview model", () => {
    render(
      <ContextModelForm
        contextProvider="vertex"
        contextModel="gemini-3-flash-preview"
        saveContextModel={vi.fn()}
      />,
    );

    expect({
      provider: (screen.getByLabelText("Provider") as HTMLSelectElement).value,
      model: (screen.getByLabelText("Model") as HTMLInputElement).value,
    }).toEqual({ provider: "vertex", model: "gemini-3-flash-preview" });
  });

  it("offers off, vertex and anthropic as providers, with off selected when nothing is saved", () => {
    render(
      <ContextModelForm
        contextProvider=""
        contextModel=""
        saveContextModel={vi.fn()}
      />,
    );
    const provider = screen.getByLabelText("Provider") as HTMLSelectElement;

    expect({
      options: [...provider.options].map((option) => option.value),
      selected: provider.value,
    }).toEqual({ options: ["off", "vertex", "anthropic"], selected: "off" });
  });
});
