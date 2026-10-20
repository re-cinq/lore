import { describe, it, expect } from "vitest";
import { shortcutAction, type KeyInput } from "./shortcut-keys";
import { applyAction } from "./ShellProvider";

const press = (key: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  typing: false,
  ...extra,
});

describe("shortcutAction", () => {
  it("toggles the palette on Cmd+K and Ctrl+K, even while typing", () => {
    const toggle = { type: "toggle", overlay: "palette" };

    expect(shortcutAction(press("k", { metaKey: true }), null)).toEqual(toggle);
    expect(
      shortcutAction(press("K", { ctrlKey: true, typing: true }), null),
    ).toEqual(toggle);
  });

  it("opens the palette on a bare slash outside a field", () => {
    expect(shortcutAction(press("/"), null)).toEqual({
      type: "open",
      overlay: "palette",
    });
    expect(shortcutAction(press("/", { typing: true }), null)).toBeNull();
  });

  it("toggles the shortcuts dialog on a bare question mark", () => {
    expect(shortcutAction(press("?"), null)).toEqual({
      type: "toggle",
      overlay: "shortcuts",
    });
    expect(shortcutAction(press("?", { altKey: true }), null)).toBeNull();
  });

  it("closes on Escape only while an overlay is open", () => {
    expect(shortcutAction(press("Escape"), "glossary")).toEqual({
      type: "close",
    });
    expect(shortcutAction(press("Escape"), null)).toBeNull();
  });
});

describe("applyAction", () => {
  it("closes a toggled overlay that is already open, and opens it otherwise", () => {
    const toggle = { type: "toggle", overlay: "palette" } as const;

    expect(applyAction(toggle, "palette")).toBeNull();
    expect(applyAction(toggle, "shortcuts")).toBe("palette");
  });
});
