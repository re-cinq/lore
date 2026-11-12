// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ActionMenu from "./ActionMenu";
import ConfirmedActionButton from "./ConfirmedActionButton";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const DELETE_QUESTION = {
  title: "Delete the plan?",
  body: "This cannot be undone.",
  confirmLabel: "Delete",
  tone: "danger",
} as const;

function renderMenu() {
  render(
    <div>
      <button type="button">Elsewhere</button>
      <ActionMenu label="More plan actions">
        <button type="button">Archive</button>
      </ActionMenu>
    </div>,
  );
}

function trigger(): HTMLElement {
  return screen.getByRole("button", { name: "More plan actions" });
}

describe("ActionMenu", () => {
  it("opens the menu on a click", () => {
    renderMenu();

    fireEvent.click(trigger());

    expect({
      expanded: trigger().getAttribute("aria-expanded"),
      archive: screen.queryByRole("button", { name: "Archive" }) !== null,
    }).toEqual({ expanded: "true", archive: true });
  });

  it("keeps the menu closed until the trigger is clicked", () => {
    renderMenu();

    expect({
      expanded: trigger().getAttribute("aria-expanded"),
      archive: screen.queryByRole("button", { name: "Archive" }),
    }).toEqual({ expanded: "false", archive: null });
  });

  it("closes the menu on Escape", () => {
    renderMenu();
    fireEvent.click(trigger());

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("closes the menu on a press outside", () => {
    renderMenu();
    fireEvent.click(trigger());

    fireEvent.mouseDown(screen.getByRole("button", { name: "Elsewhere" }));

    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("keeps the menu open on a press inside it", () => {
    renderMenu();
    fireEvent.click(trigger());

    fireEvent.mouseDown(screen.getByRole("button", { name: "Archive" }));

    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeNull();
  });

  it("keeps the menu open while its confirm popup is open", () => {
    render(
      <ActionMenu label="More plan actions">
        <ConfirmedActionButton
          action={async () => ({})}
          label="Delete plan"
          question={DELETE_QUESTION}
        />
      </ActionMenu>,
    );
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Delete plan" }));
    const dialog = screen.getByRole("dialog");

    fireEvent.mouseDown(dialog);
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeNull();
  });
});
