// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NeedRef from "./NeedRef";

describe("NeedRef", () => {
  it("cuts a 300 character value to 200 characters and an ellipsis, whole on hover", () => {
    const value = "x".repeat(300);

    render(<NeedRef runId="run-1" value={value} />);

    const shown = screen.getByTitle(value);

    expect(shown).toHaveTextContent(`${"x".repeat(200)}…`);
  });

  it("leaves a short value whole and untitled", () => {
    render(<NeedRef runId="run-1" value="task-1" />);

    expect(screen.getByText("task-1")).not.toHaveAttribute("title");
  });

  it("links a pull request URL, whatever its length", () => {
    const url = `https://github.com/re-cinq/lore/pull/412?${"q".repeat(300)}`;

    render(<NeedRef runId="run-1" value={url} />);

    expect(screen.getByRole("link")).toHaveAttribute("href", url);
  });
});
