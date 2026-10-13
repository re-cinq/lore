// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ReonboardButton from "./ReonboardButton";

describe("ReonboardButton", () => {
  it("renders the given text and invokes the action on click", async () => {
    const action = vi.fn().mockResolvedValue(undefined);

    render(<ReonboardButton action={action} text="Open enrolment PR" />);

    fireEvent.click(screen.getByRole("button", { name: "Open enrolment PR" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  it("is the plain global button, not the link-styled one", () => {
    render(<ReonboardButton action={vi.fn()} text="Update Lore setup" />);

    expect(
      screen.getByRole("button", { name: "Update Lore setup" }),
    ).toHaveAttribute("class", "");
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

    expect(await screen.findByText("starting the run…")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
    release();
  });
});
