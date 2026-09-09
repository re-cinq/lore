// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RemoveOverrideButton from "./RemoveOverrideButton";

describe("RemoveOverrideButton", () => {
  it("does not remove on the first click — it asks for confirmation naming the definition", () => {
    const remove = vi.fn().mockResolvedValue(undefined);

    render(<RemoveOverrideButton name="review" remove={remove} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText(/review/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm remove" }),
    ).toBeInTheDocument();
  });

  it("removes once the second click confirms", () => {
    const remove = vi.fn().mockResolvedValue(undefined);

    render(<RemoveOverrideButton name="review" remove={remove} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove" }));

    expect(remove).toHaveBeenCalledWith();
  });

  it("backs out of the confirm step on Cancel, without removing", () => {
    const remove = vi.fn().mockResolvedValue(undefined);

    render(<RemoveOverrideButton name="review" remove={remove} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });
});
