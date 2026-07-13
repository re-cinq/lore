// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ReonboardButton from "./ReonboardButton";

describe("ReonboardButton", () => {
  it("renders the given text and invokes the action on click", async () => {
    const action = vi.fn().mockResolvedValue(undefined);

    render(
      <ReonboardButton action={action} text="create a PR with this file" />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "create a PR with this file" }),
    );

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  it("shows a pending label and disables the button while the action runs", async () => {
    let release: () => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    render(<ReonboardButton action={action} text="create a PR" />);

    fireEvent.click(screen.getByRole("button"));

    expect(await screen.findByText("opening PR…")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
    release();
  });
});
