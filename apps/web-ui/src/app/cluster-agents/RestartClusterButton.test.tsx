// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RestartClusterButton from "./RestartClusterButton";

describe("RestartClusterButton", () => {
  it("does not restart on the first click — it asks for confirmation", () => {
    const restart = vi.fn().mockResolvedValue(undefined);

    render(<RestartClusterButton restart={restart} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));

    expect(restart).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Confirm restart" }),
    ).toBeInTheDocument();
  });

  it("restarts once the second click confirms", () => {
    const restart = vi.fn().mockResolvedValue(undefined);

    render(<RestartClusterButton restart={restart} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm restart" }));

    expect(restart).toHaveBeenCalledWith();
  });

  it("backs out of the confirm step on Cancel, without restarting", () => {
    const restart = vi.fn().mockResolvedValue(undefined);

    render(<RestartClusterButton restart={restart} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(restart).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Restart" })).toBeInTheDocument();
  });
});
