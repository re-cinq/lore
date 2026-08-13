// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const formStatus = vi.fn<() => { pending: boolean }>(() => ({
  pending: false,
}));

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();

  return { ...actual, useFormStatus: () => formStatus() };
});

import { SubmitButton } from "./SubmitButton";

describe("SubmitButton", () => {
  it("shows the idle label and stays enabled when the form is not pending", () => {
    formStatus.mockReturnValue({ pending: false });
    render(<SubmitButton pendingLabel="Saving…">Save</SubmitButton>);
    const button = screen.getByRole("button", { name: "Save" });

    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "false");
  });

  it("swaps to the pending label and disables while the form is pending", () => {
    formStatus.mockReturnValue({ pending: true });
    render(<SubmitButton pendingLabel="Saving…">Save</SubmitButton>);
    const button = screen.getByRole("button", { name: "Saving…" });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("keeps the children as the label when no pendingLabel is given", () => {
    formStatus.mockReturnValue({ pending: true });
    render(<SubmitButton>Go</SubmitButton>);
    expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
  });

  it("uses the pending prop when the caller drives its own transition", () => {
    // useTransition and useActionState produce the boolean themselves. Without an
    // override each call site rebuilds the button, which is how seven copies of
    // `disabled={pending}` ended up in one vertical.
    formStatus.mockReturnValue({ pending: false });
    render(
      <SubmitButton pending pendingLabel="Deleting…">
        Delete
      </SubmitButton>,
    );
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
  });

  it("lets an explicit false override a pending form", () => {
    formStatus.mockReturnValue({ pending: true });
    render(<SubmitButton pending={false}>Go</SubmitButton>);
    expect(screen.getByRole("button", { name: "Go" })).not.toBeDisabled();
  });

  it("stays disabled when the caller also passes disabled", () => {
    // `disabled` used to sit BEFORE the prop spread, so a caller passing it
    // silently UN-disabled the button for the duration of the submit.
    formStatus.mockReturnValue({ pending: true });
    render(<SubmitButton disabled={false}>Go</SubmitButton>);
    expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
  });

  it("disables on the caller's own disabled even when nothing is pending", () => {
    formStatus.mockReturnValue({ pending: false });
    render(<SubmitButton disabled>Go</SubmitButton>);
    expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
  });
});
