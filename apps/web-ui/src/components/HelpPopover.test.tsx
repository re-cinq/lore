// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import HelpPopover from "./HelpPopover";

describe("HelpPopover", () => {
  it("renders a collapsed trigger labelled Help by default and hides the popover", () => {
    render(<HelpPopover>panel body</HelpPopover>);

    const trigger = screen.getByRole("button", { name: "Help" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("?");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("panel body")).toBeNull();
  });

  it("uses the provided label on both the trigger and the opened dialog", () => {
    render(<HelpPopover label="Coverage help">details</HelpPopover>);

    const trigger = screen.getByRole("button", { name: "Coverage help" });

    fireEvent.click(trigger);

    expect(
      screen.getByRole("dialog", { name: "Coverage help" }),
    ).toBeInTheDocument();
  });

  it("opens the popover and shows children when the trigger is clicked", () => {
    render(
      <HelpPopover>
        <span>explainer text</span>
      </HelpPopover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Help" }));

    const trigger = screen.getByRole("button", { name: "Help" });

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog")).toHaveTextContent("explainer text");
  });

  it("toggles the popover closed on a second trigger click", () => {
    render(<HelpPopover>toggle body</HelpPopover>);
    const trigger = screen.getByRole("button", { name: "Help" });

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the popover on a mousedown outside the wrapper", async () => {
    render(
      <div>
        <HelpPopover>outside-close body</HelpPopover>
        <button type="button">elsewhere</button>
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("button", { name: "elsewhere" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the popover open on a mousedown inside the wrapper", () => {
    render(<HelpPopover>inside-stay body</HelpPopover>);

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const dialog = screen.getByRole("dialog");

    fireEvent.mouseDown(dialog);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes the popover when Escape is pressed", async () => {
    render(<HelpPopover>escape body</HelpPopover>);

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("ignores non-Escape keydowns while the popover is open", () => {
    render(<HelpPopover>other-key body</HelpPopover>);

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.keyDown(document, { key: "Enter" });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("registers no document listeners while closed", () => {
    const addSpy = vi.spyOn(document, "addEventListener");

    render(<HelpPopover>closed body</HelpPopover>);

    expect(addSpy).not.toHaveBeenCalledWith("mousedown", expect.any(Function));
    expect(addSpy).not.toHaveBeenCalledWith("keydown", expect.any(Function));
    addSpy.mockRestore();
  });

  it("removes its document listeners after the popover closes", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");

    render(<HelpPopover>cleanup body</HelpPopover>);
    const trigger = screen.getByRole("button", { name: "Help" });

    fireEvent.click(trigger);
    fireEvent.click(trigger);

    expect(removeSpy).toHaveBeenCalledWith("mousedown", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    removeSpy.mockRestore();
  });

  it("detaches its document listeners on unmount while open", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = render(<HelpPopover>unmount body</HelpPopover>);

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    unmount();

    expect(removeSpy).toHaveBeenCalledWith("mousedown", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    removeSpy.mockRestore();
  });
});
