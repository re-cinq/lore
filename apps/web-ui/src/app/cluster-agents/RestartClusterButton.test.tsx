// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RestartClusterButton from "./RestartClusterButton";

describe("RestartClusterButton", () => {
  it("triggers the bound restart action on click", () => {
    const restart = vi.fn().mockResolvedValue(undefined);

    render(<RestartClusterButton restart={restart} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));

    expect(restart).toHaveBeenCalledWith();
  });
});
