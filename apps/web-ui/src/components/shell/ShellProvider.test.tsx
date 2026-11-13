// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => <span data-icon={name} />,
}));

import ShellProvider from "./ShellProvider";
import { SidebarHelp, SidebarSearch } from "./SidebarTools";
import { readRailMode, storeRailMode } from "./rail-mode";

const renderShell = () =>
  render(
    <ShellProvider>
      <SidebarSearch />
      <SidebarHelp />
    </ShellProvider>,
  );

const palette = () =>
  screen.queryByRole("dialog", { name: "Search or jump to" });
const field = () => screen.getByRole("combobox", { name: "Search or jump to" });

beforeEach(() => {
  push.mockReset();
});

describe("command palette", () => {
  it("opens from the sidebar's search pill and closes on Escape", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /Search or jump to/ }));
    expect(palette()).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(palette()).toBeNull();
  });

  it("opens on Ctrl+K and on a bare slash", () => {
    renderShell();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(palette()).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "/" });
    expect(palette()).toBeInTheDocument();
  });

  it("moves the highlight with the arrows and opens it on Enter", () => {
    renderShell();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/");
    expect(palette()).toBeNull();
  });

  it("searches for the typed query when nothing else matches", () => {
    renderShell();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.change(field(), { target: { value: "zzz" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/search?q=zzz");
  });
});

describe("help dialogs", () => {
  it("opens the keyboard shortcuts on a bare question mark", () => {
    renderShell();
    fireEvent.keyDown(document, { key: "?" });
    expect(
      screen.getByRole("dialog", { name: "Keyboard shortcuts" }),
    ).toBeInTheDocument();
  });

  it("opens the glossary of Lore terms from the sidebar footer", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Glossary" }));
    expect(
      screen.getByRole("dialog", { name: "Glossary" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Assembly run")).toBeInTheDocument();
  });

  it("closes a dialog from its close pill", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("rail preference", () => {
  it("keeps this visit's choice when storage throws", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });

    storeRailMode("rail");
    expect(readRailMode()).toBe("rail");
    spy.mockRestore();
    get.mockRestore();
  });
});
