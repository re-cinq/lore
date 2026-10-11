// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FoldedValue from "./FoldedValue";

describe("FoldedValue", () => {
  it("starts a 20-line value folded and unfolds it on Show all 20 lines", () => {
    render(<FoldedValue lines={20}>body</FoldedValue>);
    const folded = screen.getByText("body").getAttribute("data-folded");

    fireEvent.click(screen.getByRole("button", { name: "Show all 20 lines" }));

    expect({
      folded,
      unfolded: screen.getByText("body").getAttribute("data-folded"),
    }).toEqual({ folded: "true", unfolded: "false" });
  });

  it("shows a 5-line value whole, with no toggle", () => {
    render(<FoldedValue lines={5}>body</FoldedValue>);

    expect(screen.queryByRole("button")).toBeNull();
  });
});
