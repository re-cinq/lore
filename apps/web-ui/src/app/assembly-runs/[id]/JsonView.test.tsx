// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import JsonView from "./JsonView";

describe("JsonView", () => {
  it("lists the key slot with its value * and the count 3 as code", () => {
    render(<JsonView value={{ slot: "*", count: 3 }} />);

    expect({
      key: screen.getByText("slot").tagName,
      value: screen.getByText("*").tagName,
      count: screen.getByText("3").tagName,
    }).toEqual({ key: "DT", value: "SPAN", count: "CODE" });
  });

  it("numbers the members of a list", () => {
    render(<JsonView value={["draft", "review"]} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("breaks a text with newlines into lines rather than showing \\n", () => {
    render(<JsonView value={{ text: "## repair\n\nFix it." }} />);

    expect(screen.getByText(/## repair/).textContent).toBe(
      "## repair\n\nFix it.",
    );
  });
});
