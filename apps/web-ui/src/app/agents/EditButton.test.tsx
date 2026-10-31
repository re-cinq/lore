// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditButtonView } from "./EditButton";

describe("EditButtonView", () => {
  it("shows Edit with a spinner, busy and disabled, while the edit page loads", () => {
    render(<EditButtonView pending onEdit={() => {}} />);
    const button = screen.getByRole("button", { name: /Edit/ });

    expect({
      busy: button.getAttribute("aria-busy"),
      disabled: button.hasAttribute("disabled"),
      spinner: screen.queryByRole("status", { name: "Loading" }) !== null,
    }).toEqual({ busy: "true", disabled: true, spinner: true });
  });

  it("shows Edit with no spinner, enabled, before it is clicked", () => {
    render(<EditButtonView pending={false} onEdit={() => {}} />);
    const button = screen.getByRole("button", { name: "Edit" });

    expect({
      busy: button.getAttribute("aria-busy"),
      disabled: button.hasAttribute("disabled"),
      spinner: screen.queryByRole("status", { name: "Loading" }) !== null,
    }).toEqual({ busy: "false", disabled: false, spinner: false });
  });

  it("asks to open the edit page once when clicked", () => {
    const onEdit = vi.fn();

    render(<EditButtonView pending={false} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
